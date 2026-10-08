/** XState owns screens, available controls, selection, drafts, confirmations, and pending UI orders.
 * Screen visibility is independent of order execution: returning to Pi cannot cancel an approved order.
 * Durable SDLC transitions remain exclusively in MissionController, never in this presentation machine.
 */
import { and, or, stateIn, assign, createActor, fromPromise, raise, setup, type ActorRefFrom, type SnapshotFrom, type StateValue } from "../../npm/node_modules/xstate/dist/xstate.cjs.js";
import type { TaskRecord } from "./state.ts";
import type { MergeApproval } from "./worktrees.ts";
import type { MissionChoice, MissionView } from "./workspace.ts";
import { missionChoices, missionOptions, missionSummary } from "./dashboard.ts";

export type UiFocus = "output" | "input" | "workflow" | "actions";
export type UiScreen = "hidden" | "new" | "missions" | "mission" | "options" | "naming" | "confirming";
export interface UiData {
  identity: string;
  tasks: TaskRecord[];
  pendingTitles: string[];
  workflow: Record<string, MissionChoice[]>;
  interviewSummary: string;
  merge?: Record<string, MergeApproval>;
  mergeBlockers?: Record<string, string>;
}
export interface UiOrderResult { kind: "started" | "removed" | "updated" | "refreshed"; taskId?: string; clearInput?: boolean; identity?: string }
interface UiOrder { choice: MissionChoice; input: string; draftKey: string; identity: string }
interface UiInput {
  execute: (key: string, input: string) => Promise<UiOrderResult>;
  persistSelection: (taskId?: string) => void;
}
interface UiContext extends UiInput {
  data: UiData;
  selectedId?: string;
  outputSelection?: string;
  drafts: Record<string, string>;
  focus: UiFocus;
  order?: UiOrder;
  error: string;
  confirmationVisible: boolean;
}
type UiEvent =
  | { type: "OPEN" } | { type: "CLOSE" } | { type: "HIDE" } | { type: "EXECUTE" } | { type: "DATA_CHANGED" } | { type: "MISSION_SELECTED" }
  | { type: "DATA"; data: UiData }
  | { type: "RESTORE" | "SELECT"; taskId?: string }
  | { type: "CHOOSE"; screen: UiScreen; choice: MissionChoice; input: string }
  | { type: "FOCUS"; focus: UiFocus }
  | { type: "DRAFT"; key: string; text: string }
  | { type: "MEASURE_CONFIRMATION"; visible: boolean }
  | { type: "ORDER_DONE"; result: UiOrderResult };

export function uiScreen(snapshot: { value: StateValue }): UiScreen {
  const screen = (snapshot.value as { screen?: string | { browsing?: string } }).screen;
  return (typeof screen === "string" ? screen : screen?.browsing ?? "hidden") as UiScreen;
}
export function selectedMission(context: UiContext): TaskRecord | undefined {
  return context.data.tasks.find(task => task.state.taskId === context.selectedId);
}
function draftKey(context: UiContext, screen: UiScreen): string { return screen === "new" ? "new" : context.selectedId ?? "new"; }
function choicesForScreen(screen: UiScreen, context: UiContext): MissionChoice[] {
  const task = selectedMission(context);
  const back = { value: "home", label: "Back to mission" };
  if (screen === "confirming") return [{ value: "dismiss", label: "Go back" }, { value: "confirm", label: "Confirm order" }];
  if (screen === "missions") return [...context.data.tasks.map(item => ({ value: `open/${item.state.taskId}`, label: item.state.title,
    description: missionSummary(item).split("\n")[0] })), { value: "new", label: "Start mission" }, { value: "close", label: "Return to Pi" }];
  if (screen === "new") return [{ value: "start", label: "Start mission" }, { value: "tasks", label: "Open stored mission" }, ...(task ? [back] : []), { value: "close", label: "Return to Pi" }];
  if (screen === "naming") return [{ value: "refresh", label: "Refresh status" }, { value: "tasks", label: "Open stored mission" }, { value: "close", label: "Return to Pi" }];
  if (screen === "options" && task) return missionOptions(task);
  if (screen === "mission" && task) return missionChoices(task, context.data.merge?.[task.state.taskId]);
  return [];
}
function allowed(context: UiContext, event: UiEvent): boolean {
  if (event.type !== "CHOOSE") return false;
  const screen = event.screen;
  const choices = choicesForScreen(screen, context);
  const workflow = ["mission", "options"].includes(screen) ? context.data.workflow[context.selectedId ?? ""] ?? [] : [];
  return [...choices, ...workflow].some(choice => choice.value === event.choice.value && choice.confirmation === event.choice.confirmation);
}

const machineSetup = setup({
  types: { context: {} as UiContext, events: {} as UiEvent, input: {} as UiInput },
  actors: {
    order: fromPromise<UiOrderResult, { execute: UiInput["execute"]; order: UiOrder }>(async ({ input }) => ({ ...await input.execute(input.order.choice.value, input.order.input), identity: input.order.identity })),
  },
  guards: {
    allowed: and([stateIn({ operation: "idle" }), "correctScreen", "offered"]),
    offered: ({ context, event }) => allowed(context, event),
    fromNew: ({ event }) => event.type === "CHOOSE" && event.screen === "new",
    fromMissions: ({ event }) => event.type === "CHOOSE" && event.screen === "missions",
    fromMission: ({ event }) => event.type === "CHOOSE" && event.screen === "mission",
    fromOptions: ({ event }) => event.type === "CHOOSE" && event.screen === "options",
    fromNaming: ({ event }) => event.type === "CHOOSE" && event.screen === "naming",
    correctScreen: or([
      and([stateIn({ screen: { browsing: "new" } }), "fromNew"]),
      and([stateIn({ screen: { browsing: "missions" } }), "fromMissions"]),
      and([stateIn({ screen: { browsing: "mission" } }), "fromMission"]),
      and([stateIn({ screen: { browsing: "options" } }), "fromOptions"]),
      and([stateIn({ screen: { browsing: "naming" } }), "fromNaming"]),
    ]),
    hasMission: ({ context }) => Boolean(selectedMission(context)),
    naming: ({ context }) => context.data.pendingTitles.length > 0,
    confirmationVisible: ({ context }) => context.confirmationVisible,
  },
  actions: {
    rememberOrder: assign(({ context, event }) => event.type === "CHOOSE" ? {
      order: { choice: event.choice, input: event.input, draftKey: draftKey(context, event.screen), identity: context.data.identity },
      error: "", confirmationVisible: false,
    } : {}),
    selectChoice: assign(({ event }) => event.type === "CHOOSE" ? { selectedId: event.choice.value.slice(5), outputSelection: undefined, error: "" } : {}),
    persistSelection: ({ context }) => context.persistSelection(context.selectedId),
    execute: raise({ type: "EXECUTE" }),
    focusActions: assign({ focus: "actions" as const }),
    focusInput: assign({ focus: "input" as const }),
    clearSelection: assign({ selectedId: undefined, outputSelection: undefined }),
  },
});

export const workspaceMachine = machineSetup.createMachine({
  id: "complexUi",
  type: "parallel",
  context: ({ input }) => ({ ...input, data: { identity: "", tasks: [], pendingTitles: [], workflow: {}, interviewSummary: "" },
    drafts: {}, focus: "actions", error: "", confirmationVisible: false }),
  on: {
    DATA: { actions: [assign({ data: ({ event }) => event.data }), raise({ type: "DATA_CHANGED" })] },
    RESTORE: { actions: assign(({ context, event }) => ({ selectedId: context.data.tasks.some(task => task.state.taskId === event.taskId) ? event.taskId : undefined })) },
    SELECT: { actions: [assign(({ event }) => ({ selectedId: event.taskId, outputSelection: undefined })), "persistSelection", raise({ type: "MISSION_SELECTED" })] },
    DRAFT: { actions: assign(({ context, event }) => ({ drafts: { ...context.drafts, [event.key]: event.text } })) },
    FOCUS: { actions: assign({ focus: ({ event }) => event.focus }) },
    MEASURE_CONFIRMATION: { actions: assign({ confirmationVisible: ({ event }) => event.visible }) },
  },
  states: {
    screen: {
      initial: "hidden",
      on: {
        CLOSE: { target: ".hidden" },
        HIDE: { target: ".hidden" },
        OPEN: [{ guard: "naming", target: ".browsing.naming" }, { guard: "hasMission", target: ".browsing.mission" }, { target: ".browsing.new" }],
        MISSION_SELECTED: [{ guard: stateIn({ screen: "hidden" }) }, { target: ".browsing.mission" }],
        ORDER_DONE: [
          { guard: ({ context, event }) => event.result.identity !== context.data.identity },
          { guard: stateIn({ screen: "hidden" }) },
          { guard: ({ event }) => event.result.kind === "removed", target: ".browsing.missions" },
          { guard: ({ event }) => event.result.kind === "started", target: ".browsing.naming" },
          { guard: ({ event }) => event.result.kind === "updated", target: ".browsing.mission" },
        ],
      },
      states: {
        hidden: { tags: ["hidden"] },
        browsing: {
          initial: "new",
          on: {
            CHOOSE: [
              { guard: and(["allowed", ({ event }) => event.choice.value === "close"]), target: "#complexUi.screen.hidden" },
              { guard: and(["allowed", ({ event }) => event.choice.value === "new"]), target: ".new" },
              { guard: and(["allowed", ({ event }) => event.choice.value === "tasks"]), target: ".missions" },
              { guard: and(["allowed", "hasMission", ({ event }) => event.choice.value === "home"]), target: ".mission" },
              { guard: and(["allowed", ({ event }) => event.choice.value === "home"]), target: ".new" },
              { guard: and(["allowed", ({ event }) => event.choice.value === "options"]), target: ".options" },
              { guard: and(["allowed", ({ event }) => event.choice.value.startsWith("open/")]), target: ".mission", actions: ["selectChoice", "persistSelection"] },
              { guard: and(["allowed", ({ event }) => event.choice.value.startsWith("view/") || event.choice.value.startsWith("agent/")]),
                actions: assign({ outputSelection: ({ event }) => event.choice.value }) },
              { guard: and(["allowed", ({ event }) => Boolean(event.choice.confirmation)]), target: "#complexUi.screen.confirming", actions: "rememberOrder" },
              { guard: "allowed", actions: ["rememberOrder", "execute"] },
            ],
          },
          states: {
            history: { type: "history", history: "shallow" },
            new: { entry: "focusInput", tags: ["input", "new-mission"] },
            missions: { entry: "focusActions", tags: ["mission-list"] },
            mission: { entry: "focusActions", tags: ["input", "workflow", "mission-output"], always: { guard: ({ context }) => !selectedMission(context), target: "missions", actions: "clearSelection" } },
            options: { entry: "focusActions", tags: ["workflow", "mission-output"], always: { guard: ({ context }) => !selectedMission(context), target: "missions", actions: "clearSelection" } },
            naming: { entry: "focusActions", tags: ["title-progress"], always: [
              { guard: and(["hasMission", ({ context }) => context.data.pendingTitles.length === 0]), target: "mission" },
              { guard: ({ context }) => context.data.pendingTitles.length === 0, target: "new" },
            ] },
          },
        },
        confirming: {
          entry: "focusActions", tags: ["confirmation"],
          on: {
            CLOSE: { target: "#complexUi.screen.browsing.history", actions: assign({ order: undefined, error: "" }) },
            CHOOSE: [
              { guard: ({ event }) => event.choice.value === "dismiss", target: "#complexUi.screen.browsing.history", actions: assign({ order: undefined, error: "" }) },
              { guard: and(["confirmationVisible", ({ event }) => event.choice.value === "confirm"]), target: "#complexUi.screen.browsing.history", actions: "execute" },
              { guard: ({ event }) => event.choice.value === "confirm", actions: assign({ error: "Enlarge the terminal to read the entire confirmation before issuing an order." }) },
            ],
          },
        },
      },
    },
    operation: {
      initial: "idle",
      states: {
        idle: { on: { EXECUTE: { guard: ({ context }) => Boolean(context.order), target: "working" } } },
        working: {
          tags: ["busy"],
          invoke: {
            src: "order", input: ({ context }) => ({ execute: context.execute, order: context.order! }),
            onDone: {
              target: "idle",
              actions: [assign(({ context, event }) => event.output.identity !== context.data.identity ? { order: undefined } : ({
                selectedId: event.output.kind === "removed" ? undefined : event.output.taskId ?? context.selectedId,
                outputSelection: event.output.kind === "removed" ? undefined : context.outputSelection,
                drafts: event.output.clearInput && context.order ? { ...context.drafts, [context.order.draftKey]: "" } : context.drafts,
                order: undefined, error: "",
              })), "persistSelection", raise(({ event }) => ({ type: "ORDER_DONE", result: event.output }))],
            },
            onError: { target: "idle", actions: assign(({ context, event }) => ({ order: undefined,
              error: context.order?.identity === context.data.identity ? String(event.error) : context.error })) },
          },
        },
      },
    },
  },
});
export type WorkspaceActor = ActorRefFrom<typeof workspaceMachine>;
export type WorkspaceSnapshot = SnapshotFrom<typeof workspaceMachine>;
export function createWorkspaceActor(input: UiInput): WorkspaceActor { return createActor(workspaceMachine, { input }).start(); }

/** Screen tags and permitted choices determine every visible UI part; rendering has no independent pane state. */
export function workspaceView(snapshot: WorkspaceSnapshot): MissionView {
  const { context } = snapshot;
  const screen = uiScreen(snapshot);
  const task = selectedMission(context);
  const key = draftKey(context, screen);
  const base: MissionView = { heading: "Complex work", summary: "", inputLabel: "", inputKey: key,
    initialInput: context.drafts[key] ?? "", showInput: snapshot.hasTag("input"), choices: snapshot.hasTag("busy") ? [] : choicesForScreen(screen, context),
    workflow: snapshot.hasTag("workflow") && task ? context.data.workflow[task.state.taskId] ?? [] : [],
    workflowSelection: context.outputSelection ?? (task ? `view/${task.state.currentState}` : undefined) };
  if (screen === "confirming") return { ...base, heading: context.order?.choice.label ?? "Confirm action", summary: context.order?.choice.confirmation ?? "", actionsLabel: "Confirm action",
    output: { key: "confirmation", title: "Your decision", content: "Select **Confirm order** to issue this order, or **Go back** to leave the mission unchanged." } };
  if (screen === "missions") return { ...base, heading: "Stored missions", summary: "Select a mission to open it.",
    output: { key: "mission-list", title: "Missions", content: context.data.tasks.length ? "Choose a saved mission on the right." : "No saved missions. Select Start mission to begin." } };
  if (screen === "new") return { ...base, heading: "Start mission", summary: "Type mission orders here. No stage starts without your order.",
    inputLabel: "Task description · Enter starts · Shift+Enter adds a line", startOnSubmit: true };
  if (screen === "naming") return { ...base, heading: "Naming your mission", summary: context.data.pendingTitles.join("\n") || "Preparing a title…" };
  if (screen === "options" && task) return { ...base, heading: "Mission options", summary: task.state.title };
  return { ...base, heading: task?.state.title ?? "Mission", summary: task ? [missionSummary(task), context.data.interviewSummary].filter(Boolean).join("\n") : "",
    inputLabel: "Feedback for retry / return (not live-agent steering)", actionsLabel: "Next stages / Retry" };
}
