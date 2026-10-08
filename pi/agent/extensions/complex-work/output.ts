/** Read-only workspace projections. Reports and runner logs inform the UI, never approval or routing. */
import { constants, closeSync, existsSync, lstatSync, openSync, readSync, watch, type FSWatcher } from "node:fs";
import { dirname, join } from "node:path";
import { STAGES, safePath, type Stage, type StageRun, type TaskRecord } from "./state.ts";
import type { MissionOutput, MissionChoice } from "./workspace.ts";

interface ObservedAgent {
  agent: string;
  runId?: string;
  id?: string;
  state?: string;
  status?: string;
  asyncDir?: string;
  children?: ObservedAgent[];
  steps?: ObservedAgent[];
}
interface ObservedStatus { runId?: string; nestedChildren?: ObservedAgent[]; steps?: ObservedAgent[] }
interface CachedFile { signature: string; text: string }
const LABELS: Record<string, string> = { complete: "Finished", completed: "Finished", running: "Working", started: "Working",
  failed: "Needs attention", stopping: "Stopping", stopped: "Stopped", paused: "Paused", pending: "Waiting", dispatching: "Starting" };

/** Bounded tail reads avoid loading entire transcripts or displaying prompts, thinking, and tool arguments. */
export class WorkspaceOutput {
  private cache = new Map<string, CachedFile>();

  private read(file: string, limit = 200_000): string {
    safePath(file);
    if (!existsSync(file)) return "";
    const stat = lstatSync(file);
    if (!stat.isFile()) throw new Error("Workspace output must be a regular file.");
    const signature = `${stat.mtimeMs}/${stat.size}`;
    const cached = this.cache.get(file);
    if (cached?.signature === signature) return cached.text;
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const buffer = Buffer.alloc(Math.min(limit, stat.size));
    let bytes: number;
    try { bytes = readSync(fd, buffer, 0, buffer.length, Math.max(0, stat.size - limit)); }
    finally { closeSync(fd); }
    let text = buffer.subarray(0, bytes).toString("utf8");
    if (stat.size > limit) text = text.slice(text.indexOf("\n") + 1);
    this.cache.set(file, { signature, text });
    if (this.cache.size > 64) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    return text;
  }

  private status(run: StageRun): ObservedStatus | undefined {
    if (!run.runnerDir || !run.runnerId) return undefined;
    try {
      const status = JSON.parse(this.read(join(run.runnerDir, "status.json"))) as ObservedStatus;
      return status.runId === run.runnerId ? status : undefined;
    } catch { return undefined; }
  }

  private agents(run: StageRun): ObservedAgent[] {
    const status = this.status(run);
    const flatten = (nodes: ObservedAgent[]): ObservedAgent[] => nodes.flatMap(node => [node,
      ...flatten(node.children ?? []), ...flatten((node.steps ?? []).flatMap(step => step.children ?? []))]);
    const nodes = flatten([...(status?.nestedChildren ?? []), ...(status?.steps ?? []).flatMap(step => step.children ?? [])]);
    const combined: ObservedAgent[] = [...nodes, ...(run.delegates ?? [])];
    const unique = new Map<string, ObservedAgent>();
    for (const agent of combined) {
      const id = agent.runId ?? agent.id;
      if (agent.agent && agent.agent !== run.agent && id && !unique.has(id)) unique.set(id, { ...agent, runId: id });
    }
    return [...unique.values()];
  }

  private agentDirectory(run: StageRun, agent: ObservedAgent): string | undefined {
    if (!run.runnerDir || !agent.runId || !/^[a-f\d-]{36}$/i.test(agent.runId)) return undefined;
    const directory = join(dirname(run.runnerDir), agent.runId);
    try {
      const status = JSON.parse(this.read(join(directory, "status.json"))) as ObservedStatus;
      return status.runId === agent.runId ? directory : undefined;
    } catch { return undefined; }
  }

  private activity(directory?: string): string {
    if (!directory) return "";
    const lines = this.read(join(directory, "events.jsonl")).split("\n");
    const output: string[] = [];
    for (const line of lines) {
      let event: { type?: string; toolName?: string; message?: { role?: string; content?: { type?: string; text?: string }[] } };
      try { event = JSON.parse(line); } catch { continue; }
      if (event.type === "tool_execution_start" && event.toolName) output.push(`*Using ${event.toolName}…*`);
      if (event.type !== "message_end" || event.message?.role !== "assistant" || !Array.isArray(event.message.content)) continue;
      for (const part of event.message.content) {
        if (part.type === "text" && typeof part.text === "string") output.push(part.text);
      }
    }
    return output.slice(-80).join("\n\n");
  }

  workflow(task: TaskRecord): MissionChoice[] {
    return STAGES.map(stage => {
      const run = task.state.stageRuns.filter(item => item.stage === stage && !item.stale).at(-1);
      const approved = task.state.history.some(item => item.from === stage && item.action === "next" && !item.stale);
      const current = stage === task.state.currentState;
      const marker = approved ? "✓" : current ? "●" : "○";
      const label = stage === "end" ? "Finish" : stage === "merge" ? "Merge decision" : stage;
      const state = current ? task.state.executionStatus === "awaiting-user" ? "Your decision" : LABELS[task.state.executionStatus] ?? task.state.executionStatus
        : approved ? "Accepted" : run ? LABELS[run.status] ?? run.status : "Waiting";
      return { value: `view/${stage}`, label: `${marker} ${label} · ${state}` };
    }).flatMap(item => {
      const stage = item.value.slice(5);
      const run = task.state.stageRuns.filter(candidate => candidate.stage === stage).at(-1);
      const children = run ? this.agents(run).map(agent => ({ value: `agent/${run.id}/${agent.runId}`,
        label: `  ${agent.agent.replace(/^complex-/, "")} · ${LABELS[agent.state ?? agent.status ?? ""] ?? "Not observed"}` })) : [];
      return [item, ...children];
    });
  }

  output(task: TaskRecord, selection?: string): MissionOutput {
    if (selection?.startsWith("agent/")) return this.agentOutput(task, selection);
    const stage = selection?.startsWith("view/") ? selection.slice(5) as Stage : task.state.currentState;
    const run = task.state.stageRuns.filter(item => item.stage === stage).at(-1);
    if (!run) return { key: `${task.state.taskId}/${stage}`, title: stage === "merge" ? "Merge decision" : stage,
      content: stage === "merge" ? `Tests are accepted for the committed candidate. Nothing is merged until you confirm **Merge and close task**.\n\nThe final action merges into **${task.state.worktree?.baseBranch ?? "the original branch"}**; it does not commit unfinished work or push. The branch and worktree stay available.\n\n${task.state.worktree?.mergeAttempt?.error ?? "If Git reports conflicts, resolve and commit the merge in normal Pi, then return here to finish."}`
        : "No findings yet. Select an available action to continue." };
    const findings = this.read(join(task.folder, run.report));
    const activity = this.activity(run.runnerDir);
    const live = run.status === "running" || run.status === "dispatching";
    const finalResponse = !live && run.runnerOutput ? this.read(join(task.folder, run.runnerOutput)) : "";
    const content = findings && live && activity ? `${findings}\n\n## Recent agent activity\n\n${activity}`
      : findings || finalResponse || activity;
    return { key: run.id, title: `${stage}${run.stale ? " · Historical findings" : ""}`,
      content: content || "Waiting for agent output…", live };
  }

  private agentOutput(task: TaskRecord, selection: string): MissionOutput {
    const [, runId, agentId] = selection.split("/");
    const run = task.state.stageRuns.find(item => item.id === runId);
    const agent = run && this.agents(run).find(item => item.runId === agentId);
    if (!run || !agent) return { key: selection, title: "Agent output", content: "No saved output is available for this agent." };
    const directory = this.agentDirectory(run, agent);
    return { key: selection, title: agent.agent.replace(/^complex-/, ""), live: ["running", "started"].includes(agent.state ?? agent.status ?? ""),
      content: this.activity(directory) || (directory ? this.read(join(directory, "output-0.log")) : "") || "Waiting for observed agent output…" };
  }

  directories(task: TaskRecord): string[] {
    return [...new Set([task.folder, ...task.state.stageRuns.filter(run => ["running", "dispatching"].includes(run.status)).flatMap(run => [
      ...(run.runnerDir ? [run.runnerDir] : []), ...this.agents(run).flatMap(agent => this.agentDirectory(run, agent) ?? []),
    ])])];
  }
}

/** Workspace-only file watchers; closing the UI never touches an agent process or its ownership. */
export class WorkspaceObserver {
  private watchers = new Map<string, FSWatcher>();
  private timer?: ReturnType<typeof setTimeout>;

  sync(directories: string[], changed: () => void): void {
    const wanted = new Set(directories.filter(directory => existsSync(directory) && lstatSync(directory).isDirectory()));
    for (const [directory, watcher] of this.watchers) {
      if (wanted.has(directory)) continue;
      watcher.close();
      this.watchers.delete(directory);
    }
    for (const directory of wanted) {
      if (this.watchers.has(directory)) continue;
      const watcher = watch(directory, () => {
        if (this.timer) return;
        this.timer = setTimeout(() => { this.timer = undefined; changed(); }, 80);
      });
      watcher.on("error", () => { watcher.close(); this.watchers.delete(directory); });
      this.watchers.set(directory, watcher);
    }
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
  }
}
