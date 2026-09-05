/**
 * Complex-work control surface.
 *
 * Replaces the fragile prompt-only entry point with a session-persistent state
 * machine. The extension does not execute subagent workflows itself (that
 * runtime is owned by pi-subagents); it exposes the one allowed transition and
 * rejects an out-of-order direct workflow launch while a complex-work session
 * is active. User-attention sounds are emitted only at workflow gates that
 * require an explicit user decision or verification.
 */

import { spawn } from "node:child_process";
import type {
  AgentToolResult,
  ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const WORKFLOW_ROOT = "/home/might/.pi/agent/workflows";
const CONTROL_TOOL = "complex_work_control";
const STATE_ENTRY = "complex-work-state";
const WINDOWS_BEEP = "[console]::beep(880, 160)";
const IS_WSL = Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP);
const controlParams = Type.Object({
  action: Type.String({
    description:
      "One of: status, plan, plan-failed, retry-plan, plan-complete, go, complete, replan, finish, abandon",
  }),
  missionId: Type.Optional(
    Type.String({
      description: "Mission id returned by the planning workflow",
    }),
  ),
  resultStatus: Type.Optional(
    Type.String({
      description:
        "Exact status returned by the completed workflow; required by action complete",
    }),
  ),
});

const workflowPaths = {
  plan: `${WORKFLOW_ROOT}/complex-work-plan.js`,
  execute: `${WORKFLOW_ROOT}/complex-work-execute-wave.js`,
  integrate: `${WORKFLOW_ROOT}/complex-work-integrate-wave.js`,
  review: `${WORKFLOW_ROOT}/complex-work-review-wave.js`,
  verify: `${WORKFLOW_ROOT}/complex-work-verify-wave.js`,
  close: `${WORKFLOW_ROOT}/complex-work-close-wave.js`,
} as const;

type WorkflowAction = keyof typeof workflowPaths;
type Phase =
  | "ready-to-plan"
  | "planning"
  | "planning-failed"
  | "awaiting-go"
  | "executing"
  | "integrating"
  | "reviewing"
  | "verifying"
  | "closing"
  | "awaiting-review-decision"
  | "inactive";

const completionStatuses: Partial<Record<Phase, string>> = {
  executing: "integration-required",
  integrating: "review-required",
  reviewing: "review-disposition-required",
  verifying: "user-verification-recorded",
  closing: "wave-closed",
};

type ComplexWorkState = {
  request: string;
  phase: Phase;
  missionId?: string;
  rootSessionFile?: string;
  expectedAction?: WorkflowAction;
  updatedAt: string;
};

const actions = new Set<WorkflowAction>(
  Object.keys(workflowPaths) as WorkflowAction[],
);
const phases = new Set<Phase>([
  "ready-to-plan",
  "planning",
  "planning-failed",
  "awaiting-go",
  "executing",
  "integrating",
  "reviewing",
  "verifying",
  "closing",
  "awaiting-review-decision",
  "inactive",
]);

type PhaseHistory = { phase: Phase; startedAt: string; endedAt?: string };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isComplexWorkState(value: unknown): value is ComplexWorkState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (
    !isNonEmptyString(candidate.request) ||
    typeof candidate.phase !== "string" ||
    !phases.has(candidate.phase as Phase)
  )
    return false;
  if (
    !isNonEmptyString(candidate.updatedAt) ||
    Number.isNaN(Date.parse(candidate.updatedAt))
  )
    return false;
  for (const field of ["missionId", "rootSessionFile"] as const) {
    if (candidate[field] !== undefined && !isNonEmptyString(candidate[field]))
      return false;
  }
  if (candidate.expectedAction === undefined) return true;
  if (
    typeof candidate.expectedAction !== "string" ||
    !isWorkflowAction(candidate.expectedAction)
  )
    return false;
  const expectedAction =
    candidate.phase === "planning"
      ? "plan"
      : actionForPhase(candidate.phase as Phase);
  return candidate.expectedAction === expectedAction;
}

export function replayComplexWorkStates(
  entries: readonly unknown[],
): ComplexWorkState[] {
  const states: ComplexWorkState[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as {
      type?: unknown;
      customType?: unknown;
      data?: unknown;
    };
    if (
      candidate.type === "custom" &&
      candidate.customType === STATE_ENTRY &&
      isComplexWorkState(candidate.data)
    ) {
      // Session branch order is the persistence chronology. Timestamps are display
      // metadata and may regress after a clock adjustment, so they must not affect
      // which valid snapshot is restored as current state.
      states.push(candidate.data);
    }
  }
  return states;
}

export function buildPhaseHistory(
  states: readonly ComplexWorkState[],
): PhaseHistory[] {
  const history: PhaseHistory[] = [];
  for (const state of states) {
    const previous = history.at(-1);
    if (previous?.phase === state.phase) continue;
    if (previous) previous.endedAt = state.updatedAt;
    history.push({ phase: state.phase, startedAt: state.updatedAt });
  }
  return history;
}

function formatDuration(startedAt: string, endedAt: string): string {
  const milliseconds = Math.max(0, Date.parse(endedAt) - Date.parse(startedAt));
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function formatComplexWorkStatus(
  state: ComplexWorkState,
  history: readonly PhaseHistory[],
): string {
  const lines = [
    `Complex work: ${state.request}`,
    `Current phase: ${state.phase}`,
    `Mission: ${state.missionId ?? "none"}`,
    `Next: ${state.expectedAction ?? actionForPhase(state.phase) ?? "await user decision"}`,
    `Last updated: ${state.updatedAt}`,
    "History:",
    ...history.map(
      (item) =>
        `- ${item.phase}: ${item.endedAt ? formatDuration(item.startedAt, item.endedAt) : `current since ${item.startedAt}`}`,
    ),
  ];
  return lines.join("\n");
}

class ComplexWorkStatusPopup {
  private offset = 0;
  private readonly text: string;
  private readonly done: () => void;
  private readonly requestRender: () => void;

  constructor(text: string, done: () => void, requestRender: () => void) {
    this.text = text;
    this.done = done;
    this.requestRender = requestRender;
  }
  handleInput(data: string): void {
    if (
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.enter) ||
      data === "q"
    )
      this.done();
    else if (matchesKey(data, Key.up))
      this.offset = Math.max(0, this.offset - 1);
    else if (matchesKey(data, Key.down)) {
      this.offset = Math.min(
        this.offset + 1,
        Math.max(0, this.text.split("\n").length - 12),
      );
    }
    this.requestRender();
  }
  render(width: number): string[] {
    const content = this.text.split("\n");
    const visible = content.slice(this.offset, this.offset + 12);
    return [
      truncateToWidth(
        "┌─ Complex Work Status ─────────────────────────",
        width,
      ),
      ...visible.map((line) => truncateToWidth(`│ ${line}`, width)),
      truncateToWidth("└─ ↑↓ history • Enter/Esc/q close ─────────────", width),
    ];
  }
  invalidate(): void {}
}

function now(): string {
  return new Date().toISOString();
}

function ringTerminalBell(): void {
  process.stdout.write("\x07");
}

function startSound(command: string, args: string[]): void {
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", ringTerminalBell);
    child.unref();
  } catch {
    ringTerminalBell();
  }
}

function playUserAttentionSound(): void {
  if (process.env.PI_SOUND_DISABLED === "1") return;

  if (process.platform === "darwin") {
    startSound("afplay", ["/System/Library/Sounds/Glass.aiff"]);
    return;
  }
  if (process.platform === "win32" || IS_WSL) {
    startSound("powershell.exe", ["-NoProfile", "-Command", WINDOWS_BEEP]);
    return;
  }
  startSound("canberra-gtk-play", ["--id=complete"]);
}

function isWorkflowAction(value: string): value is WorkflowAction {
  return actions.has(value as WorkflowAction);
}

function actionForPhase(phase: Phase): WorkflowAction | undefined {
  const mapping: Partial<Record<Phase, WorkflowAction>> = {
    "ready-to-plan": "plan",
    executing: "execute",
    integrating: "integrate",
    reviewing: "review",
    verifying: "verify",
    closing: "close",
  };
  return mapping[phase];
}

function describeState(state: ComplexWorkState): string {
  const mission = state.missionId ? ` Mission: ${state.missionId}.` : "";
  if (state.phase === "awaiting-go") {
    return `Plan recorded. Await explicit user GO before execution.${mission}`;
  }
  if (state.phase === "planning") {
    return state.expectedAction
      ? `Planning workflow is authorized and awaiting launch.${mission}`
      : `Planning workflow is running or its result needs recording.${mission}`;
  }
  if (state.phase === "planning-failed") {
    return `Planning failure recorded. Call ${CONTROL_TOOL} with action "retry-plan" to authorize a retry.${mission}`;
  }
  if (state.phase === "awaiting-review-decision") {
    return `Review found blocking or unresolved findings. Present them to the user and wait. The user may choose replan or abandon.${mission}`;
  }
  if (state.phase === "inactive") {
    return "No active complex-work session.";
  }
  const next = actionForPhase(state.phase);
  return next
    ? `Phase: ${state.phase}. Call ${CONTROL_TOOL} with action "${next}" to authorize its workflow launch.${mission}`
    : `Phase: ${state.phase}.${mission}`;
}

export default function complexWorkExtension(pi: ExtensionAPI) {
  let state: ComplexWorkState | undefined;
  let isRootSession = false;

  const persist = () => {
    if (!state) return;
    state.updatedAt = now();
    pi.appendEntry(STATE_ENTRY, state);
  };

  const enableControl = () => {
    const active = pi.getActiveTools();
    pi.setActiveTools([...new Set([...active, CONTROL_TOOL])]);
  };

  const disableControl = () => {
    pi.setActiveTools(
      pi.getActiveTools().filter((name) => name !== CONTROL_TOOL),
    );
  };

  const launchInstructions = (action: WorkflowAction): string => {
    const missionArgument =
      action === "plan" && !state?.missionId
        ? "Start this as a mission-backed asynchronous workflow from the target repository; do not set mission: false."
        : `Attach it to missionId ${state?.missionId ?? "<mission-id>"} and launch asynchronously from the target repository.`;
    const expectedStatus = completionStatuses[state?.phase ?? "ready-to-plan"];
    let next = `Only after the workflow succeeds with status ${expectedStatus}, call complex_work_control with action "complete" and resultStatus "${expectedStatus}". On failure, report the blocker and leave this phase unchanged.`;
    if (action === "plan") {
      next =
        'When planning succeeds, call complex_work_control with action "plan-complete" and its missionId. If the workflow fails, call action "plan-failed" with resultStatus "planning-failed" before requesting retry-plan.';
    } else if (action === "review") {
      next =
        'After the workflow succeeds, call complex_work_control with action "complete" and its exact resultStatus: either "review-passed" or "review-decision-required".';
    }
    return [
      `Authorized workflow: ${action}.`,
      `Call subagent with workflowScriptPath: ${workflowPaths[action]}.`,
      missionArgument,
      next,
    ].join(" ");
  };

  /** Applies one validated state-machine action for both the agent tool and UI commands. */
  const executeControlAction = async (params: {
    action: string;
    missionId?: string;
    resultStatus?: string;
  }): Promise<AgentToolResult<{ state: ComplexWorkState | null }>> => {
    const action = params.action.trim();
    if (!state) {
      throw new Error(
        "No active complex-work session. Start one with /complex-work <request>.",
      );
    }
    if (action === "status") {
      return {
        content: [{ type: "text", text: describeState(state) }],
        details: { state: state ?? null },
      };
    }
    if (action === "abandon" || action === "finish") {
      state = {
        ...state,
        phase: "inactive",
        expectedAction: undefined,
        updatedAt: now(),
      };
      persist();
      disableControl();
      const message =
        action === "finish"
          ? "Complex-work session finished; workflow control is disabled. Report the final diff, checks, task records, risks, and user verification evidence."
          : "Complex-work session abandoned; workflow control is disabled.";
      return {
        content: [{ type: "text", text: message }],
        details: { state: null },
      };
    }
    if (action === "plan-failed") {
      if (
        state.phase !== "planning" ||
        state.expectedAction ||
        params.resultStatus !== "planning-failed"
      ) {
        throw new Error(
          "plan-failed requires a launched planning workflow that returned resultStatus planning-failed.",
        );
      }
      state = {
        ...state,
        phase: "planning-failed",
        expectedAction: undefined,
        updatedAt: now(),
      };
      persist();
      return {
        content: [{ type: "text", text: describeState(state) }],
        details: { state: state ?? null },
      };
    }
    if (action === "plan-complete") {
      if (state.phase !== "planning" || !params.missionId?.trim()) {
        throw new Error(
          "plan-complete requires a successful planning launch and its missionId.",
        );
      }
      if (state.missionId && params.missionId.trim() !== state.missionId) {
        throw new Error(
          `Replanning must remain attached to mission ${state.missionId}.`,
        );
      }
      state = {
        ...state,
        phase: "awaiting-go",
        missionId: params.missionId.trim(),
        expectedAction: undefined,
        updatedAt: now(),
      };
      persist();
      playUserAttentionSound();
      return {
        content: [
          {
            type: "text",
            text: `Planning recorded. Publish STATUS: and WORK PLAN:, then wait for explicit user GO. Mission: ${state.missionId}.`,
          },
        ],
        details: { state: state ?? null },
      };
    }
    if (action === "go") {
      if (state.phase !== "awaiting-go") {
        throw new Error("GO is only valid after planning has completed.");
      }
      state = {
        ...state,
        phase: "executing",
        expectedAction: "execute",
        updatedAt: now(),
      };
      persist();
      return {
        content: [{ type: "text", text: launchInstructions("execute") }],
        details: { state: state ?? null },
      };
    }
    if (action === "replan" || action === "retry-plan") {
      const isReviewReplan =
        action === "replan" && state.phase === "awaiting-review-decision";
      const isPlanningRetry =
        action === "retry-plan" && state.phase === "planning-failed";
      if (!isReviewReplan && !isPlanningRetry) {
        throw new Error(
          action === "replan"
            ? "Replan is only valid after review requires a user decision."
            : "retry-plan is only valid after plan-failed records an authorized planning workflow failure.",
        );
      }
      state = {
        ...state,
        phase: "planning",
        expectedAction: "plan",
        updatedAt: now(),
      };
      persist();
      return {
        content: [{ type: "text", text: launchInstructions("plan") }],
        details: { state: state ?? null },
      };
    }
    if (action === "complete") {
      let next: Phase | undefined;
      const expectedStatus = completionStatuses[state.phase];
      if (state.phase === "reviewing") {
        if (params.resultStatus === "review-passed") next = "verifying";
        else if (params.resultStatus === "review-decision-required") {
          next = "awaiting-review-decision";
        } else {
          throw new Error(
            "Refusing to advance reviewing: resultStatus must be review-passed or review-decision-required.",
          );
        }
      } else {
        const nextPhase: Partial<Record<Phase, Phase>> = {
          executing: "integrating",
          integrating: "reviewing",
          verifying: "closing",
          closing: "awaiting-go",
        };
        next = nextPhase[state.phase];
        if (!next)
          throw new Error(`complete is not valid during ${state.phase}.`);
        if (!expectedStatus || params.resultStatus !== expectedStatus) {
          throw new Error(
            `Refusing to advance ${state.phase}: complete requires resultStatus ${expectedStatus ?? "<none>"} from a successful workflow result.`,
          );
        }
      }
      state = {
        ...state,
        phase: next,
        expectedAction: undefined,
        updatedAt: now(),
      };
      persist();
      if (
        next === "awaiting-go" ||
        next === "awaiting-review-decision" ||
        next === "verifying"
      ) {
        playUserAttentionSound();
      }
      return {
        content: [
          {
            type: "text",
            text:
              next === "awaiting-go"
                ? "Wave closed. Publish RESULTS: and PLAN UPDATE:, then wait for the user's GO before the next wave."
                : describeState(state),
          },
        ],
        details: { state: state ?? null },
      };
    }
    if (!isWorkflowAction(action) || action !== actionForPhase(state.phase)) {
      throw new Error(
        `Action ${action} is not valid during ${state.phase}. ${describeState(state)}`,
      );
    }
    state = {
      ...state,
      phase: action === "plan" ? "planning" : state.phase,
      expectedAction: action,
      updatedAt: now(),
    };
    persist();
    return {
      content: [{ type: "text", text: launchInstructions(action) }],
      details: { state: state ?? null },
    };
  };

  pi.registerTool<typeof controlParams, { state: ComplexWorkState | null }>({
    name: CONTROL_TOOL,
    label: "Complex Work Control",
    description:
      "Authorizes exactly one valid complex-work workflow transition and reports workflow status.",
    promptSnippet:
      "Advance or inspect the active complex-work workflow state machine",
    promptGuidelines: [
      "Use complex_work_control before every complex-work workflow launch; do not launch complex-work scripts directly.",
      "Use complex_work_control action status to report the current complex-work gate without guessing.",
    ],
    parameters: controlParams,
    execute: (_toolCallId, params) => executeControlAction(params),
  });

  const steeringCommands = {
    status: "Report the current complex-work phase",
    plan: "Authorize and launch complex-work planning",
    go: "Approve and launch the next complex-work execution wave",
    execute: "Authorize and launch the current execution phase",
    integrate: "Authorize and launch the current integration phase",
    review: "Authorize and launch the current review phase",
    verify: "Record explicit user verification for the reviewed wave",
    close: "Authorize and launch the current close phase",
    replan: "Authorize replanning after a blocking review",
    "retry-plan": "Retry a previously failed planning workflow",
    finish: "Finish the active complex-work session",
    abandon: "Abandon the active complex-work session",
  } as const;

  for (const [action, description] of Object.entries(steeringCommands)) {
    pi.registerCommand(`complex-work-${action}`, {
      description,
      handler: async (_args, ctx) => {
        if (!state || state.phase === "inactive" || !isRootSession) {
          ctx.ui.notify(
            "No active complex-work session in this root session.",
            "error",
          );
          return Promise.resolve();
        }
        if (action === "status") {
          const history = buildPhaseHistory(
            replayComplexWorkStates(ctx.sessionManager.getBranch()),
          );
          const text = formatComplexWorkStatus(state, history);
          if (ctx.mode !== "tui") {
            ctx.ui.notify(text, "info");
            return Promise.resolve();
          }
          return ctx.ui.custom<void>(
            (tui, _theme, _keybindings, done) =>
              new ComplexWorkStatusPopup(
                text,
                () => done(),
                () => tui.requestRender(),
              ),
            {
              overlay: true,
              overlayOptions: {
                width: "70%",
                minWidth: 40,
                maxHeight: "80%",
                anchor: "center",
                margin: 1,
              },
            },
          );
        }
        try {
          const result = await executeControlAction({ action });
          const content = result.content[0];
          ctx.ui.notify(
            content?.type === "text" ? content.text : describeState(state),
            "info",
          );
        } catch (error) {
          ctx.ui.notify(
            error instanceof Error ? error.message : String(error),
            "error",
          );
        }
      },
    });
  }

  pi.on("session_start", (_event, ctx) => {
    const entries = ctx.sessionManager.getBranch();
    const replayed = replayComplexWorkStates(entries);
    state = replayed.at(-1);
    isRootSession = Boolean(
      state?.rootSessionFile &&
        state.rootSessionFile === ctx.sessionManager.getSessionFile(),
    );
    if (state && state.phase !== "inactive" && isRootSession) enableControl();
    else disableControl();
  });

  pi.on("tool_call", (event) => {
    if (!state || !isRootSession || event.toolName !== "subagent") return;
    const input = event.input as {
      workflowScriptPath?: unknown;
      missionId?: unknown;
    };
    const workflowScriptPath = String(input.workflowScriptPath ?? "");
    if (!workflowScriptPath) return;
    const expected = state.expectedAction;
    if (!expected) {
      return {
        block: true,
        reason: `Complex-work is active. Authorize the next transition with ${CONTROL_TOOL} first.`,
      };
    }
    if (workflowScriptPath !== workflowPaths[expected]) {
      return {
        block: true,
        reason: `Only ${workflowPaths[expected]} is authorized during the ${state.phase} phase.`,
      };
    }
    if (state.missionId && String(input.missionId ?? "") !== state.missionId) {
      return {
        block: true,
        reason: `This workflow must remain attached to mission ${state.missionId}.`,
      };
    }
    state = { ...state, expectedAction: undefined, updatedAt: now() };
    persist();
  });

  pi.registerCommand("complex-work", {
    description: "Start a gated, dependency-aware complex-work session",
    handler: async (args, ctx) => {
      const request = args.trim();
      if (!request) {
        ctx.ui.notify("Usage: /complex-work <request>", "warning");
        return Promise.resolve();
      }
      if (state && state.phase !== "inactive") {
        ctx.ui.notify(
          `A complex-work session is already ${state.phase}. Finish or abandon it before starting another.`,
          "error",
        );
        return Promise.resolve();
      }
      const rootSessionFile = ctx.sessionManager.getSessionFile();
      if (!rootSessionFile) {
        ctx.ui.notify(
          "Complex-work requires a persisted Pi session. Save or restart the session, then try again.",
          "error",
        );
        return Promise.resolve();
      }
      isRootSession = true;
      state = {
        request,
        phase: "ready-to-plan",
        rootSessionFile,
        expectedAction: undefined,
        updatedAt: now(),
      };
      persist();
      enableControl();
      pi.setSessionName(`Complex work: ${request.slice(0, 72)}`);
      await executeControlAction({ action: "plan" });
      ctx.ui.notify("Complex-work planning started.", "info");
      pi.sendUserMessage(
        `Launch the already-authorized complex-work planning workflow now using ${workflowPaths.plan}. Start it as a mission-backed asynchronous workflow from the target repository. Do not call ${CONTROL_TOOL} again before launching it.`,
      );
    },
  });
}
