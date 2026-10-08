/** Full-screen renderer for XState UI snapshots. Keyboard events cannot mutate workflow or screen state directly. */
import { getMarkdownTheme, getSelectListTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, Editor, Key, Markdown, matchesKey, SelectList, Text, truncateToWidth, visibleWidth,
  type Component, type Focusable, type SelectItem, type TUI } from "@earendil-works/pi-tui";
import { uiScreen, type WorkspaceActor, type UiFocus } from "./ui-machine.ts";

export interface MissionChoice extends SelectItem { confirmation?: string }
export interface MissionOutput { key: string; title: string; content: string; live?: boolean }
export interface MissionView {
  heading: string;
  summary: string;
  inputLabel: string;
  inputKey?: string;
  initialInput?: string;
  showInput?: boolean;
  actionsLabel?: string;
  choices: MissionChoice[];
  workflow?: MissionChoice[];
  workflowSelection?: string;
  output?: MissionOutput;
  startOnSubmit?: boolean;
}
function padded(line: string, width: number): string {
  const text = truncateToWidth(line, Math.max(1, width));
  return text + " ".repeat(Math.max(0, width - visibleWidth(text)));
}

export class MissionWorkspace implements Component, Focusable {
  private editor: Editor;
  private actions: SelectList;
  private workflow: SelectList;
  private hasFocus = false;
  private closed = false;
  private subscription?: { unsubscribe(): void };
  private output?: MissionOutput;
  private markdown?: Markdown;
  private outputOffset = 0;
  private followOutput = true;
  private outputHeight = 1;
  private view: MissionView;

  constructor(private tui: TUI, private theme: Theme, private ui: WorkspaceActor, private snapshot: () => MissionView, private done: () => void) {
    this.view = snapshot();
    this.editor = new Editor(tui, { borderColor: text => theme.fg("muted", text), selectList: getSelectListTheme() });
    this.editor.setText(this.view.initialInput ?? "");
    this.editor.onChange = text => ui.send({ type: "DRAFT", key: this.view.inputKey ?? "new", text });
    this.editor.onSubmit = text => {
      ui.send({ type: "DRAFT", key: this.view.inputKey ?? "new", text });
      this.choose(this.view.startOnSubmit ? this.view.choices.find(item => item.value === "start") : this.selected(), text);
    };
    this.actions = this.createList(this.view.choices, "actions");
    this.workflow = this.createList(this.view.workflow ?? [], "workflow", this.view.workflowSelection);
    this.updateOutput();
    this.subscription = ui.subscribe(() => this.refresh());
  }

  private get focus(): UiFocus { return this.ui.getSnapshot().context.focus; }
  private get busy(): boolean { return this.ui.getSnapshot().hasTag("busy"); }
  private get confirming(): boolean { return uiScreen(this.ui.getSnapshot()) === "confirming"; }
  get focused(): boolean { return this.hasFocus; }
  set focused(value: boolean) {
    this.hasFocus = value;
    this.editor.focused = value && this.focus === "input" && this.view.showInput !== false;
  }

  private createList(items: MissionChoice[], kind: "actions" | "workflow", previous?: string, maxVisible = 7): SelectList {
    const list = new SelectList(items, Math.max(1, maxVisible), getSelectListTheme());
    const position = items.findIndex(item => item.value === previous);
    if (position >= 0) list.setSelectedIndex(position);
    list.onSelect = item => this.choose(items.find(choice => choice.value === item.value));
    if (kind === "workflow") list.onSelectionChange = item => { if (this.focus === "workflow") this.choose(items.find(choice => choice.value === item.value)); };
    return list;
  }

  private selected(): MissionChoice | undefined {
    return this.view.choices.find(choice => choice.value === this.actions.getSelectedItem()?.value);
  }

  refresh(): void {
    if (this.closed) return;
    if (uiScreen(this.ui.getSnapshot()) === "hidden") return this.close();
    const previous = this.view;
    this.view = this.snapshot();
    if (this.view.inputKey !== previous.inputKey || this.view.initialInput !== previous.initialInput) {
      const text = this.view.initialInput ?? "";
      if (this.editor.getText() !== text) this.editor.setText(text);
    }
    this.actions = this.createList(this.view.choices, "actions", this.actions.getSelectedItem()?.value);
    this.workflow = this.createList(this.view.workflow ?? [], "workflow", this.view.workflowSelection ?? this.workflow.getSelectedItem()?.value);
    if (!this.focusTargets().includes(this.focus)) this.ui.send({ type: "FOCUS", focus: "actions" });
    this.focused = this.hasFocus;
    this.updateOutput();
    this.tui.requestRender();
  }

  private updateOutput(): void {
    const output = this.view.output ?? { key: "welcome", title: "Mission",
      content: "Describe your task below, then select Start mission.\n\nWork stays isolated until you explicitly approve a merge.\n\nEsc returns to normal Pi; background agents keep working." };
    if (output.key !== this.output?.key) { this.outputOffset = 0; this.followOutput = Boolean(output.live); }
    if (output.content !== this.output?.content || output.key !== this.output?.key) this.markdown = new Markdown(output.content, 0, 0, getMarkdownTheme());
    this.output = output;
  }

  private choose(choice?: MissionChoice, input = this.editor.getExpandedText()): void {
    if (!choice || this.busy || this.closed) return;
    this.ui.send({ type: "CHOOSE", screen: uiScreen(this.ui.getSnapshot()), choice, input });
  }

  private focusTargets(): UiFocus[] {
    if (this.confirming) return ["actions"];
    return ["output", ...(this.view.showInput !== false ? ["input" as const] : []),
      ...(this.view.workflow?.length ? ["workflow" as const] : []), "actions"];
  }
  private cycleFocus(reverse: boolean): void {
    const targets = this.focusTargets();
    this.ui.send({ type: "FOCUS", focus: targets[(targets.indexOf(this.focus) + (reverse ? -1 : 1) + targets.length) % targets.length] });
    this.focused = this.hasFocus;
  }

  handleInput(data: string): void {
    if (this.closed) return;
    if (matchesKey(data, Key.escape) || matchesKey(data, "ctrl+c")) { this.ui.send({ type: "CLOSE" }); return; }
    if (this.busy) return;
    if (matchesKey(data, Key.tab) || matchesKey(data, "shift+tab")) this.cycleFocus(matchesKey(data, "shift+tab"));
    else if (matchesKey(data, Key.pageUp) || matchesKey(data, Key.pageDown)) this.scrollOutput(matchesKey(data, Key.pageUp) ? -this.outputHeight : this.outputHeight);
    else if (this.focus === "output") this.handleOutputInput(data);
    else if (this.focus === "workflow") this.workflow.handleInput(data);
    else if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
      this.ui.send({ type: "FOCUS", focus: "actions" });
      this.focused = this.hasFocus;
      this.actions.handleInput(data);
    } else if (this.focus === "input") this.editor.handleInput(data);
    else this.actions.handleInput(data);
    this.tui.requestRender();
  }

  private handleOutputInput(data: string): void {
    if (matchesKey(data, Key.up)) this.scrollOutput(-1);
    if (matchesKey(data, Key.down)) this.scrollOutput(1);
    if (matchesKey(data, Key.home)) { this.outputOffset = 0; this.followOutput = false; }
    if (matchesKey(data, Key.end)) this.followOutput = true;
  }
  private scrollOutput(amount: number): void { this.followOutput = false; this.outputOffset = Math.max(0, this.outputOffset + amount); }
  private title(text: string, focus: UiFocus): string { return this.theme.fg(this.focus === focus ? "accent" : "muted", text); }

  private renderOutput(width: number, height: number): string[] {
    const lines = this.markdown?.render(width) ?? [];
    this.outputHeight = Math.max(1, height - 1);
    const maximum = Math.max(0, lines.length - this.outputHeight);
    this.outputOffset = this.followOutput ? maximum : Math.min(this.outputOffset, maximum);
    return [this.title(`${this.output?.title ?? "Agent output"}${this.output?.live ? " · live" : ""}`, "output"),
      ...lines.slice(this.outputOffset, this.outputOffset + this.outputHeight)];
  }

  private renderInput(width: number, maximum: number): string[] {
    if (this.view.showInput === false || maximum < 3) return [];
    const lines = this.editor.render(width);
    const budget = Math.max(1, maximum - 2);
    const cursor = lines.findIndex(line => line.includes(CURSOR_MARKER));
    const start = Math.max(0, (cursor < 0 ? lines.length - 1 : cursor) - budget + 1);
    return [this.theme.fg("muted", "─".repeat(width)), this.title(this.view.inputLabel, "input"), ...lines.slice(start, start + budget)];
  }
  private renderLeft(width: number, height: number): string[] {
    const input = this.renderInput(width, Math.max(3, Math.floor(height / 3)));
    const output = this.renderOutput(width, Math.max(1, height - input.length));
    return [...output, ...Array(Math.max(0, height - output.length - input.length)).fill(""), ...input].slice(0, height);
  }
  private renderRight(width: number, height: number): string[] {
    const workflowHeight = this.view.workflow?.length ? Math.min(this.view.workflow.length + 2, Math.floor(height / 2)) : 0;
    const lines: string[] = [];
    if (workflowHeight) {
      this.workflow = this.createList(this.view.workflow ?? [], "workflow", this.workflow.getSelectedItem()?.value, Math.max(1, workflowHeight - 2));
      lines.push(this.title("Workflow / Agents", "workflow"), ...this.workflow.render(width).slice(0, workflowHeight - 1), "");
    }
    this.actions = this.createList(this.view.choices, "actions", this.actions.getSelectedItem()?.value, Math.max(1, height - lines.length - 2));
    lines.push(this.title(this.view.actionsLabel ?? "Actions", "actions"), ...this.actions.render(width));
    return lines.slice(0, height);
  }

  render(width: number): string[] {
    const rows = Math.max(1, this.tui.terminal.rows);
    const error = this.ui.getSnapshot().context.error;
    const heading = this.theme.fg("accent", this.theme.bold(`COMPLEX WORK · ${this.view.heading}`));
    const summaryLines = new Text(this.view.summary, 0, 0).render(width);
    const summaryBudget = this.confirming ? Math.max(0, rows - 6 - (error ? 1 : 0)) : 2;
    const visible = this.confirming && rows >= 7 && summaryLines.length <= summaryBudget;
    if (visible !== this.ui.getSnapshot().context.confirmationVisible) this.ui.send({ type: "MEASURE_CONFIRMATION", visible });
    const header = [heading, ...summaryLines.slice(0, summaryBudget)];
    if (error) header.push(this.theme.fg("error", truncateToWidth(error, width)));
    const bodyHeight = Math.max(0, rows - header.length - 1);
    let body: string[];
    if (width >= 80) {
      const rightWidth = Math.min(42, Math.max(30, Math.floor(width * 0.34)));
      const leftWidth = width - rightWidth - 3;
      const left = this.renderLeft(leftWidth, bodyHeight);
      const right = this.renderRight(rightWidth, bodyHeight);
      body = Array.from({ length: bodyHeight }, (_, index) => `${padded(left[index] ?? "", leftWidth)} ${this.theme.fg("muted", "│")} ${padded(right[index] ?? "", rightWidth)}`);
    } else {
      const rightHeight = this.focus === "workflow" || this.focus === "actions" || this.confirming ? Math.max(3, Math.floor(bodyHeight * 0.55)) : Math.min(5, Math.floor(bodyHeight / 3));
      body = [...this.renderLeft(width, Math.max(0, bodyHeight - rightHeight)), ...this.renderRight(width, rightHeight)];
    }
    const footer = this.theme.fg("dim", `Esc → Pi · Tab panels · ↑↓ choose · PgUp/Dn output${this.busy ? " · Working…" : ""}`);
    return [...header, ...body, ...Array(Math.max(0, rows - header.length - body.length - 1)).fill(""), footer].slice(0, rows).map(line => padded(line, width));
  }
  invalidate(): void {
    this.editor.invalidate(); this.actions.invalidate(); this.workflow.invalidate();
    if (this.output) this.markdown = new Markdown(this.output.content, 0, 0, getMarkdownTheme());
  }
  close(): void { if (!this.closed) { this.closed = true; this.subscription?.unsubscribe(); this.done(); } }
  dispose(): void { this.closed = true; this.subscription?.unsubscribe(); }
}
