// Complex-work lifecycle controller: root-agent judgment with deterministic RPC orchestration.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type {
  AgentToolResult,
  ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import {
  compileImplementationPlan,
  compileResearchBrief,
  type ImplementationPlan,
  planSchema,
  type ResearchBrief,
  researchBriefSchema,
  validateImplementationPlan,
} from "../lib/complex-work-contracts.ts";

const WORKFLOW_ROOT = "/home/might/.pi/agent/workflows";
const CONTROL_TOOL = "complex_work_control";
const STATE_ENTRY = "complex-work-state";
const RPC_REQUEST_EVENT = "subagents:rpc:v1:request";
const RPC_REPLY_PREFIX = "subagents:rpc:v1:reply:";
const RPC_COMPLETE_EVENT = "subagent:async-complete";
const RPC_TIMEOUT_MS = 10_000;
const MAX_COMPILATION_ATTEMPTS = 3;
const WINDOWS_BEEP = "[console]::beep(880, 160)";
const IS_WSL = Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP);

const workflowPaths = {
  execute: `${WORKFLOW_ROOT}/complex-work-execute-wave.js`,
  integrate: `${WORKFLOW_ROOT}/complex-work-integrate-wave.js`,
  review: `${WORKFLOW_ROOT}/complex-work-review-wave.js`,
  verify: `${WORKFLOW_ROOT}/complex-work-verify-wave.js`,
  close: `${WORKFLOW_ROOT}/complex-work-close-wave.js`,
} as const;

type WorkflowAction = keyof typeof workflowPaths;
type RunKind =
  | "research"
  | "research-repair"
  | "plan"
  | "seed-plan"
  | WorkflowAction;
type Phase =
  | "researching"
  | "research-failed"
  | "awaiting-research-decision"
  | "planning"
  | "ready-to-plan"
  | "planning-failed"
  | "awaiting-go"
  | "executing"
  | "integrating"
  | "reviewing"
  | "verifying"
  | "closing"
  | "awaiting-execution-correction"
  | "awaiting-review-decision"
  | "awaiting-integration-correction"
  | "inactive";

type ActiveRun = {
  runId: string;
  kind: RunKind;
  attempt?: number;
  startedAt: string;
};

type CompilationDraft = {
  markdown: string;
  errors: string[];
  reports?: string[];
};

type FailureRecord = {
  kind: RunKind;
  message: string;
  evidence?: string;
  failedAt: string;
};

type ComplexWorkState = {
  request: string;
  phase: Phase;
  missionId?: string;
  rootSessionFile?: string;
  projectCwd?: string;
  researchBrief?: ResearchBrief;
  researchDraft?: CompilationDraft;
  researchAttempts?: number;
  plan?: ImplementationPlan;
  planDraft?: CompilationDraft;
  planningAttempts?: number;
  correctionEvidence?: string;
  activeRun?: ActiveRun;
  lastFailure?: FailureRecord;
  /** Legacy launch authorization retained only so old session entries still replay. */
  expectedAction?: string;
  updatedAt: string;
};

type PhaseHistory = { phase: Phase; startedAt: string; endedAt?: string };

type RpcReply =
  | { success: true; data: RpcData }
  | { success: false; error: { code?: string; message?: string } };

type RpcData = {
  text?: string;
  details?: {
    runId?: string;
    asyncId?: string;
    missionId?: string;
  };
};

const phases = new Set<Phase>([
  "researching",
  "research-failed",
  "awaiting-research-decision",
  "planning",
  "ready-to-plan",
  "planning-failed",
  "awaiting-go",
  "executing",
  "integrating",
  "reviewing",
  "verifying",
  "closing",
  "awaiting-execution-correction",
  "awaiting-review-decision",
  "awaiting-integration-correction",
  "inactive",
]);
const runKinds = new Set<RunKind>([
  "research",
  "research-repair",
  "plan",
  "seed-plan",
  "execute",
  "integrate",
  "review",
  "verify",
  "close",
]);

const controlParams = Type.Object({
  action: Type.String({
    description:
      "One of: status, research-complete, resolve-research, retry-research, plan-complete, retry-plan, go, execute, integrate, review, verify, close, replan, finish, abandon",
  }),
  researchBrief: Type.Optional(researchBriefSchema),
  decisions: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })),
  plan: Type.Optional(planSchema),
});

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isResearchBrief(value: unknown): value is ResearchBrief {
  return Value.Check(researchBriefSchema, value);
}

function isActiveRun(value: unknown): value is ActiveRun {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNonEmptyString(candidate.runId) &&
    typeof candidate.kind === "string" &&
    runKinds.has(candidate.kind as RunKind) &&
    (candidate.attempt === undefined ||
      (Number.isInteger(candidate.attempt) && Number(candidate.attempt) > 0)) &&
    isNonEmptyString(candidate.startedAt) &&
    !Number.isNaN(Date.parse(candidate.startedAt))
  );
}

function isComplexWorkState(value: unknown): value is ComplexWorkState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (
    !isNonEmptyString(candidate.request) ||
    typeof candidate.phase !== "string" ||
    !phases.has(candidate.phase as Phase) ||
    !isNonEmptyString(candidate.updatedAt) ||
    Number.isNaN(Date.parse(candidate.updatedAt))
  )
    return false;
  for (const field of [
    "missionId",
    "rootSessionFile",
    "projectCwd",
    "correctionEvidence",
    "expectedAction",
  ] as const) {
    if (candidate[field] !== undefined && !isNonEmptyString(candidate[field]))
      return false;
  }
  if (
    candidate.researchBrief !== undefined &&
    !isResearchBrief(candidate.researchBrief)
  )
    return false;
  if (candidate.plan !== undefined && !Value.Check(planSchema, candidate.plan))
    return false;
  if (candidate.activeRun !== undefined && !isActiveRun(candidate.activeRun))
    return false;
  return true;
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

function nextDescription(state: ComplexWorkState): string {
  if (state.activeRun) return `${state.activeRun.kind} running`;
  const mapping: Partial<Record<Phase, string>> = {
    researching: "await parallel research or retry-research",
    "research-failed": "retry research or submit research-complete",
    "awaiting-research-decision": "resolve user decisions",
    planning: "await plan compilation",
    "planning-failed": "retry planning or submit plan-complete",
    "awaiting-go": "await user GO",
    executing: "retry execute",
    integrating: "retry integrate",
    reviewing: "retry review",
    verifying: "await user verification",
    closing: "retry close",
    "awaiting-execution-correction": "retry execute, replan, or abandon",
    "awaiting-review-decision": "replan or abandon",
    "awaiting-integration-correction": "replan or abandon",
  };
  return mapping[state.phase] ?? "none";
}

export function formatComplexWorkStatus(
  state: ComplexWorkState,
  history: readonly PhaseHistory[],
): string {
  return [
    `Complex work: ${state.request}`,
    `Current phase: ${state.phase}`,
    `Mission: ${state.missionId ?? "none"}`,
    `Next: ${nextDescription(state)}`,
    `Last updated: ${state.updatedAt}`,
    "History:",
    ...history.map(
      (item) =>
        `- ${item.phase}: ${item.endedAt ? formatDuration(item.startedAt, item.endedAt) : `current since ${item.startedAt}`}`,
    ),
  ].join("\n");
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
    ) {
      this.done();
    } else if (matchesKey(data, Key.up)) {
      this.offset = Math.max(0, this.offset - 1);
    } else if (matchesKey(data, Key.down)) {
      this.offset = Math.min(
        this.offset + 1,
        Math.max(0, this.text.split("\n").length - 12),
      );
    }
    this.requestRender();
  }

  render(width: number): string[] {
    const visible = this.text.split("\n").slice(this.offset, this.offset + 12);
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
  } else if (process.platform === "win32" || IS_WSL) {
    startSound("powershell.exe", ["-NoProfile", "-Command", WINDOWS_BEEP]);
  } else {
    startSound("canberra-gtk-play", ["--id=complete"]);
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function completionStatus(
  payload: Record<string, unknown>,
): string | undefined {
  const workflow = asRecord(payload.workflow);
  const value = asRecord(workflow?.value);
  return typeof value?.status === "string" ? value.status : undefined;
}

function completionEvidence(payload: Record<string, unknown>): string {
  const workflow = asRecord(payload.workflow);
  if (workflow?.value !== undefined) return JSON.stringify(workflow.value);
  if (typeof payload.error === "string") return payload.error;
  if (typeof payload.summary === "string") return payload.summary;
  return "No completion evidence was returned.";
}

function completionOutput(payload: Record<string, unknown>): string {
  const results = Array.isArray(payload.results) ? payload.results : [];
  const first = asRecord(results[0]);
  if (typeof first?.output === "string" && first.output.trim())
    return first.output.trim();
  if (typeof payload.output === "string" && payload.output.trim())
    return payload.output.trim();
  if (typeof payload.summary === "string" && payload.summary.trim())
    return payload.summary.trim();
  return "";
}

function completionWorkflowValue(
  payload: Record<string, unknown>,
): Record<string, unknown> | undefined {
  return asRecord(asRecord(payload.workflow)?.value);
}

function researchReportOutputs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const outputs: string[] = [];
  for (const report of value) {
    const output = asRecord(report)?.output;
    if (typeof output === "string") outputs.push(output);
  }
  return outputs;
}

function researchWorkflow(request: string): string {
  return [
    `const request = ${JSON.stringify(request)};`,
    "const scoutTasks = [",
    '{ key: "research-architecture", agent: "scout", context: "fresh", output: false, task: "Research the architecture and production code paths relevant to this request. Identify concrete files, symbols, ownership boundaries, and dependencies. Be read-only and cite evidence. Request: " + request },',
    '{ key: "research-validation", agent: "scout", context: "fresh", output: false, task: "Research existing tests, diagnostics, build commands, and acceptance seams relevant to this request. Identify fast focused checks and evidence gaps. Be read-only. Request: " + request },',
    '{ key: "research-contracts", agent: "scout", context: "fresh", output: false, task: "Research public contracts, configuration, documentation, persistence, and compatibility constraints relevant to this request. Be read-only and cite evidence. Request: " + request },',
    '{ key: "research-risks", agent: "scout", context: "fresh", output: false, task: "Independently challenge the request for hidden coupling, concurrency hazards, integration risks, and decisions requiring user authority. Be read-only and cite evidence. Request: " + request }',
    "];",
    "const scoutResults = await runs.all(scoutTasks);",
    "const reports = scoutResults.map((result, index) => ({ index, ok: result.ok, runId: result.runId, output: result.output || \"\" }));",
    "if (!reports.some((report) => report.ok && report.output.trim())) throw new Error(\"All research scouts failed to return evidence.\");",
    'const synthesisTask = ["Synthesize these parallel scout reports into an authoritative research brief for the request.", "Return ordinary Markdown and end with the required fenced JSON research object. Do not plan implementation.", "Request:", request, "Scout reports:", JSON.stringify(reports)].join("\\n\\n");',
    'const synthesis = await runs.run("research-synthesis", { agent: "research-synthesis", context: "fresh", task: synthesisTask, output: false });',
    "if (!synthesis.ok || !synthesis.output?.trim()) throw new Error(\"Research synthesis did not return a readable brief.\");",
    'return { status: "research-draft", reports, synthesisMarkdown: synthesis.output.trim(), synthesisRunId: synthesis.runId };',
  ].join("\n");
}

function researchRepairTask(state: ComplexWorkState): string {
  return [
    "Repair the prior research synthesis into the required authoritative brief.",
    "Return ordinary Markdown ending with one valid fenced JSON research object. Do not plan implementation.",
    `Request: ${state.request}`,
    `Compiler errors: ${JSON.stringify(state.researchDraft?.errors ?? [])}`,
    `Prior synthesis: ${state.researchDraft?.markdown ?? ""}`,
    `Scout reports: ${JSON.stringify(state.researchDraft?.reports ?? [])}`,
  ].join("\n\n");
}

function plannerTask(state: ComplexWorkState): string {
  return [
    "Create an implementation-only dependency plan from the authoritative research brief below.",
    "Maximize safe parallel lanes and independent ready waves. Return ordinary Markdown ending with one valid fenced JSON machine plan; do not call structured_output or implement.",
    "Do not repeat broad reconnaissance. Perform only a narrow check for a concrete missing fact.",
    `Machine-plan JSON schema: ${JSON.stringify(planSchema)}`,
    `Authoritative research brief: ${JSON.stringify(state.researchBrief)}`,
    state.plan ? `Previous plan: ${JSON.stringify(state.plan)}` : "",
    state.lastFailure
      ? `Correction evidence: ${JSON.stringify(state.lastFailure)}`
      : "",
    state.correctionEvidence
      ? `Required correction evidence: ${state.correctionEvidence}`
      : "",
    state.planDraft
      ? `Prior invalid draft: ${state.planDraft.markdown}\nCompiler errors: ${JSON.stringify(state.planDraft.errors)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function seedPlanWorkflow(
  plan: ImplementationPlan,
  researchBrief: ResearchBrief,
): string {
  return [
    `const submittedPlan = ${JSON.stringify(plan)};`,
    `const submittedResearchBrief = ${JSON.stringify(researchBrief)};`,
    'const previous = (await state.get("complexWork")) || {};',
    "const reviewHistory = previous.pendingReview ? [...(previous.reviewHistory || []), previous.pendingReview] : (previous.reviewHistory || []);",
    'await state.set("complexWork", { ...previous, researchBrief: submittedResearchBrief, plan: submittedPlan, planRevision: (previous.planRevision || 0) + 1, completedWaveIds: previous.completedWaveIds || [], activeExecution: null, failedExecution: null, pendingIntegration: null, failedIntegration: null, pendingReview: null, pendingUserVerification: null, reviewHistory });',
    'return { status: "plan-stored" };',
  ].join("\n");
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
    pi.setActiveTools([...new Set([...pi.getActiveTools(), CONTROL_TOOL])]);
  };

  const disableControl = () => {
    pi.setActiveTools(
      pi.getActiveTools().filter((name) => name !== CONTROL_TOOL),
    );
  };

  const sendAgentNotice = (content: string, triggerTurn = true) => {
    pi.sendMessage(
      {
        customType: "complex-work",
        content,
        display: true,
      },
      { triggerTurn, deliverAs: "followUp" },
    );
  };

  const rpc = (method: "spawn" | "stop", params: unknown): Promise<RpcData> =>
    new Promise((resolve, reject) => {
      const requestId = randomUUID();
      const replyEvent = `${RPC_REPLY_PREFIX}${requestId}`;
      let unsubscribe: (() => void) | void;
      const timer = setTimeout(() => {
        if (typeof unsubscribe === "function") unsubscribe();
        reject(new Error(`pi-subagents RPC ${method} timed out.`));
      }, RPC_TIMEOUT_MS);
      unsubscribe = pi.events.on(replyEvent, (raw) => {
        clearTimeout(timer);
        if (typeof unsubscribe === "function") unsubscribe();
        const reply = raw as RpcReply;
        if (!reply?.success) {
          reject(
            new Error(
              reply?.error?.message ?? `pi-subagents RPC ${method} failed.`,
            ),
          );
          return;
        }
        resolve(reply.data ?? {});
      });
      pi.events.emit(RPC_REQUEST_EVENT, {
        version: 1,
        requestId,
        method,
        params,
        source: { extension: "complex-work" },
      });
    });

  const recordLaunchFailure = (kind: RunKind, error: unknown) => {
    if (!state) return;
    state = {
      ...state,
      activeRun: undefined,
      lastFailure: {
        kind,
        message: error instanceof Error ? error.message : String(error),
        failedAt: now(),
      },
      updatedAt: now(),
    };
    persist();
  };

  const launch = async (
    kind: RunKind,
    params: Record<string, unknown>,
    attempt?: number,
  ): Promise<string> => {
    if (!state) throw new Error("No active complex-work session.");
    if (state.activeRun)
      throw new Error(`${state.activeRun.kind} is already running.`);
    let data: RpcData;
    try {
      data = await rpc("spawn", {
        ...params,
        async: true,
        cwd: state.projectCwd ?? process.cwd(),
      });
    } catch (error) {
      recordLaunchFailure(kind, error);
      throw error;
    }
    const runId = data.details?.runId ?? data.details?.asyncId;
    if (!isNonEmptyString(runId)) {
      const error = new Error("pi-subagents RPC spawn returned no run id.");
      recordLaunchFailure(kind, error);
      throw error;
    }
    state = {
      ...state,
      missionId: data.details?.missionId ?? state.missionId,
      activeRun: { runId, kind, attempt, startedAt: now() },
      lastFailure: undefined,
      expectedAction: undefined,
      updatedAt: now(),
    };
    persist();
    return runId;
  };

  const launchResearch = async (resetAttempts: boolean) => {
    if (!state) throw new Error("No active complex-work session.");
    const attempt = resetAttempts ? 1 : (state.researchAttempts ?? 0) + 1;
    state = {
      ...state,
      phase: "researching",
      researchAttempts: attempt,
      researchDraft: resetAttempts ? undefined : state.researchDraft,
      updatedAt: now(),
    };
    persist();
    await launch(
      "research",
      {
        workflowScript: researchWorkflow(state.request),
        mission: false,
        chatProgress: "auto",
      },
      attempt,
    );
  };

  const launchResearchRepair = async () => {
    if (!state?.researchDraft)
      throw new Error("Research repair requires a retained invalid draft.");
    const attempt = (state.researchAttempts ?? 1) + 1;
    state = { ...state, researchAttempts: attempt, updatedAt: now() };
    persist();
    await launch(
      "research-repair",
      {
        agent: "research-synthesis",
        context: "fresh",
        task: researchRepairTask(state),
        mission: false,
        output: false,
      },
      attempt,
    );
  };

  const launchPlanner = async (resetAttempts: boolean) => {
    if (!state?.researchBrief)
      throw new Error("Planning requires a persisted research brief.");
    const attempt = resetAttempts ? 1 : (state.planningAttempts ?? 0) + 1;
    state = {
      ...state,
      phase: "planning",
      planningAttempts: attempt,
      planDraft: resetAttempts ? undefined : state.planDraft,
      updatedAt: now(),
    };
    persist();
    await launch(
      "plan",
      {
        agent: "plan-unit",
        task: plannerTask(state),
        context: "fresh",
        mission: false,
        output: false,
      },
      attempt,
    );
  };

  const launchPlanSeed = async (plan: ImplementationPlan) => {
    if (!state) throw new Error("No active complex-work session.");
    const mission = state.missionId
      ? { missionId: state.missionId }
      : {
          mission: {
            title: `Complex work: ${state.request.slice(0, 72)}`,
            objective: state.request,
          },
        };
    if (!state.researchBrief)
      throw new Error("The implementation plan has no research brief.");
    await launch("seed-plan", {
      workflowScript: seedPlanWorkflow(plan, state.researchBrief),
      ...mission,
      chatProgress: "off",
    });
  };

  const launchWorkflow = async (kind: WorkflowAction) => {
    if (!state?.missionId)
      throw new Error("The implementation plan has no mission id.");
    await launch(kind, {
      workflowScriptPath: workflowPaths[kind],
      missionId: state.missionId,
      chatProgress: "auto",
    });
  };

  const acceptResearchBrief = async (brief: ResearchBrief) => {
    if (!state) return;
    const needsDecision = brief.unresolvedDecisions.length > 0;
    state = {
      ...state,
      phase: needsDecision ? "awaiting-research-decision" : "planning",
      researchBrief: brief,
      researchDraft: undefined,
      activeRun: undefined,
      updatedAt: now(),
    };
    persist();
    if (needsDecision) {
      playUserAttentionSound();
      sendAgentNotice(
        [
          "Parallel research completed, but user authority is required before planning.",
          `Unresolved decisions: ${JSON.stringify(brief.unresolvedDecisions)}`,
          "Present only these decisions to the user. After the user answers, call complex_work_control with action resolve-research and a decisions array recording the answers.",
        ].join("\n\n"),
      );
      return;
    }
    await launchPlanner(true);
  };

  const compileResearchDraft = async (
    markdown: string,
    reports: string[],
  ) => {
    if (!state) return;
    const compiled = compileResearchBrief(markdown);
    if (compiled.ok) {
      await acceptResearchBrief(compiled.value);
      return;
    }
    state = {
      ...state,
      activeRun: undefined,
      researchDraft: { markdown, reports, errors: compiled.errors },
      updatedAt: now(),
    };
    persist();
    if ((state.researchAttempts ?? 1) < MAX_COMPILATION_ATTEMPTS) {
      await launchResearchRepair();
      return;
    }
    state = {
      ...state,
      phase: "research-failed",
      lastFailure: {
        kind: "research-repair",
        message: "Research brief compilation exhausted automatic retries.",
        evidence: compiled.errors.join("\n"),
        failedAt: now(),
      },
      updatedAt: now(),
    };
    persist();
    playUserAttentionSound();
    sendAgentNotice(
      "Automatic research compilation exhausted its retry budget. Inspect status, then retry-research or submit a validated research-complete override.",
    );
  };

  const compilePlanDraft = async (markdown: string) => {
    if (!state) return;
    const compiled = compileImplementationPlan(markdown);
    if (compiled.ok) {
      state = {
        ...state,
        plan: compiled.value,
        planDraft: undefined,
        correctionEvidence: undefined,
        activeRun: undefined,
        updatedAt: now(),
      };
      persist();
      await launchPlanSeed(compiled.value);
      return;
    }
    state = {
      ...state,
      activeRun: undefined,
      planDraft: { markdown, errors: compiled.errors },
      updatedAt: now(),
    };
    persist();
    if ((state.planningAttempts ?? 1) < MAX_COMPILATION_ATTEMPTS) {
      await launchPlanner(false);
      return;
    }
    state = {
      ...state,
      phase: "planning-failed",
      lastFailure: {
        kind: "plan",
        message: "Plan compilation exhausted automatic retries.",
        evidence: compiled.errors.join("\n"),
        failedAt: now(),
      },
      updatedAt: now(),
    };
    persist();
    playUserAttentionSound();
    sendAgentNotice(
      "Automatic plan compilation exhausted its retry budget. Inspect status, then retry-plan or submit a validated plan-complete override.",
    );
  };

  const failCompletion = (
    activeRun: ActiveRun,
    payload: Record<string, unknown>,
  ) => {
    if (!state) return;
    let failedPhase = state.phase;
    if (activeRun.kind.startsWith("research")) failedPhase = "research-failed";
    else if (activeRun.kind === "plan") failedPhase = "planning-failed";
    state = {
      ...state,
      phase: failedPhase,
      activeRun: undefined,
      lastFailure: {
        kind: activeRun.kind,
        message: `${activeRun.kind} failed`,
        evidence: completionEvidence(payload),
        failedAt: now(),
      },
      updatedAt: now(),
    };
    persist();
    sendAgentNotice(
      `Complex-work ${activeRun.kind} failed and remains retryable. Inspect complex_work_control status and the recorded failure before retrying.`,
    );
  };

  const handleCompletion = async (raw: unknown) => {
    if (!state?.activeRun || !isRootSession) return;
    const payload = asRecord(raw);
    if (!payload || payload.runId !== state.activeRun.runId) return;
    const activeRun = state.activeRun;
    const succeeded = payload.success === true && payload.state !== "failed";
    if (!succeeded) {
      failCompletion(activeRun, payload);
      return;
    }

    if (activeRun.kind === "research") {
      const workflowValue = completionWorkflowValue(payload);
      const reports = researchReportOutputs(workflowValue?.reports);
      const markdown =
        typeof workflowValue?.synthesisMarkdown === "string"
          ? workflowValue.synthesisMarkdown
          : "";
      await compileResearchDraft(markdown, reports);
      return;
    }

    if (activeRun.kind === "research-repair") {
      await compileResearchDraft(
        completionOutput(payload),
        state.researchDraft?.reports ?? [],
      );
      return;
    }

    if (activeRun.kind === "plan") {
      await compilePlanDraft(completionOutput(payload));
      return;
    }

    const status = completionStatus(payload);
    if (activeRun.kind === "seed-plan" && status === "plan-stored") {
      state = {
        ...state,
        phase: "awaiting-go",
        activeRun: undefined,
        updatedAt: now(),
      };
      persist();
      playUserAttentionSound();
      sendAgentNotice(
        [
          "Research and implementation planning completed automatically.",
          `STATUS: awaiting explicit user GO.`,
          `WORK PLAN: ${JSON.stringify(state.plan)}`,
          "Present the plan concisely and wait. Do not call GO on the user's behalf.",
        ].join("\n\n"),
      );
      return;
    }

    if (activeRun.kind === "execute") {
      if (status === "integration-required") {
        state = {
          ...state,
          phase: "integrating",
          activeRun: undefined,
          updatedAt: now(),
        };
        persist();
        await launchWorkflow("integrate");
        return;
      }
      if (status === "execution-blocked") {
        const evidence = completionEvidence(payload);
        state = {
          ...state,
          phase: "awaiting-execution-correction",
          activeRun: undefined,
          correctionEvidence: evidence,
          lastFailure: {
            kind: "execute",
            message: "Execution requires correction.",
            evidence,
            failedAt: now(),
          },
          updatedAt: now(),
        };
        persist();
        playUserAttentionSound();
        sendAgentNotice(
          "Execution was blocked. Present the evidence and ask the user to retry execution, replan, or abandon.",
        );
        return;
      }
      if (status === "complete") {
        state = {
          ...state,
          phase: "inactive",
          activeRun: undefined,
          updatedAt: now(),
        };
        persist();
        disableControl();
        sendAgentNotice(
          "Complex-work has no remaining execution waves.",
          false,
        );
        return;
      }
    }

    if (activeRun.kind === "integrate") {
      if (status === "review-required") {
        state = {
          ...state,
          phase: "reviewing",
          activeRun: undefined,
          updatedAt: now(),
        };
        persist();
        await launchWorkflow("review");
        return;
      }
      if (status === "integration-failed") {
        const evidence = completionEvidence(payload);
        state = {
          ...state,
          phase: "awaiting-integration-correction",
          activeRun: undefined,
          correctionEvidence: evidence,
          lastFailure: {
            kind: "integrate",
            message: "Integration requires correction.",
            evidence,
            failedAt: now(),
          },
          updatedAt: now(),
        };
        persist();
        playUserAttentionSound();
        sendAgentNotice(
          "Integration was rejected. Present the recorded blockers and ask the user to replan or abandon.",
        );
        return;
      }
    }

    if (activeRun.kind === "review") {
      let phase: Phase | undefined;
      if (status === "review-passed") phase = "verifying";
      else if (status === "review-decision-required")
        phase = "awaiting-review-decision";
      if (phase) {
        const correctionEvidence =
          phase === "awaiting-review-decision"
            ? completionEvidence(payload)
            : state.correctionEvidence;
        state = {
          ...state,
          phase,
          activeRun: undefined,
          correctionEvidence,
          updatedAt: now(),
        };
        persist();
        playUserAttentionSound();
        sendAgentNotice(
          phase === "verifying"
            ? "Review passed. Ask the user to verify the runnable wave, then use /complex-work-verify."
            : "Review found blockers. Present them and ask the user to replan or abandon.",
        );
        return;
      }
    }

    if (
      activeRun.kind === "verify" &&
      status === "user-verification-recorded"
    ) {
      state = {
        ...state,
        phase: "closing",
        activeRun: undefined,
        updatedAt: now(),
      };
      persist();
      await launchWorkflow("close");
      return;
    }

    if (activeRun.kind === "close" && status === "wave-closed") {
      state = {
        ...state,
        phase: "awaiting-go",
        activeRun: undefined,
        updatedAt: now(),
      };
      persist();
      playUserAttentionSound();
      sendAgentNotice(
        "Wave closed. Present RESULTS and PLAN UPDATE, then wait for the user's GO.",
      );
      return;
    }

    failCompletion(activeRun, payload);
  };

  pi.events.on(RPC_COMPLETE_EVENT, (payload) => {
    void handleCompletion(payload).catch((error) => {
      if (state?.activeRun) recordLaunchFailure(state.activeRun.kind, error);
      sendAgentNotice(
        `Complex-work completion handling failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  });

  const executeControlAction = async (
    params: Static<typeof controlParams>,
  ): Promise<AgentToolResult<{ state: ComplexWorkState | null }>> => {
    const action = params.action.trim();
    if (!state)
      throw new Error(
        "No active complex-work session. Start one with /complex-work <request>.",
      );

    if (action === "status") {
      return {
        content: [{ type: "text", text: nextDescription(state) }],
        details: { state },
      };
    }

    if (action === "abandon" || action === "finish") {
      const activeRun = state.activeRun;
      if (activeRun) await rpc("stop", { id: activeRun.runId });
      state = {
        ...state,
        phase: "inactive",
        activeRun: undefined,
        updatedAt: now(),
      };
      persist();
      disableControl();
      return {
        content: [
          {
            type: "text",
            text: `Complex-work session ${action === "finish" ? "finished" : "abandoned"}.`,
          },
        ],
        details: { state: null },
      };
    }

    if (action === "retry-research") {
      if (
        (state.phase !== "researching" && state.phase !== "research-failed") ||
        state.activeRun
      ) {
        throw new Error(
          "retry-research requires an idle researching or research-failed phase.",
        );
      }
      if (state.researchDraft) await launchResearchRepair();
      else await launchResearch(false);
      return {
        content: [{ type: "text", text: "Research retry launched." }],
        details: { state },
      };
    }

    if (action === "research-complete") {
      const validPhase =
        state.phase === "researching" || state.phase === "research-failed";
      if (!validPhase || state.activeRun) {
        throw new Error(
          "research-complete is only valid while research is idle or failed.",
        );
      }
      if (!params.researchBrief)
        throw new Error("research-complete requires researchBrief.");
      await acceptResearchBrief(params.researchBrief);
      return {
        content: [
          {
            type: "text",
            text:
              params.researchBrief.unresolvedDecisions.length > 0
                ? "Research recorded; awaiting user decisions."
                : "Research recorded; planning launched.",
          },
        ],
        details: { state },
      };
    }

    if (action === "resolve-research") {
      if (state.phase !== "awaiting-research-decision" || !state.researchBrief)
        throw new Error(
          "resolve-research requires unresolved research decisions.",
        );
      if (!params.decisions?.length)
        throw new Error("resolve-research requires a non-empty decisions array.");
      state = {
        ...state,
        researchBrief: {
          ...state.researchBrief,
          unresolvedDecisions: [],
          resolvedDecisions: [
            ...(state.researchBrief.resolvedDecisions ?? []),
            ...params.decisions,
          ],
        },
        updatedAt: now(),
      };
      persist();
      await launchPlanner(true);
      return {
        content: [{ type: "text", text: "Decisions recorded; planning launched." }],
        details: { state },
      };
    }

    if (action === "plan-complete") {
      const validPhase =
        state.phase === "planning" || state.phase === "planning-failed";
      if (!validPhase || state.activeRun) {
        throw new Error(
          "plan-complete requires an idle or failed planning phase.",
        );
      }
      if (!params.plan)
        throw new Error("plan-complete requires a normalized plan.");
      const validation = validateImplementationPlan(params.plan);
      if (!validation.ok) {
        throw new Error(
          `plan-complete rejected the plan:\n${validation.errors.join("\n")}`,
        );
      }
      state = {
        ...state,
        plan: validation.value,
        correctionEvidence: undefined,
        updatedAt: now(),
      };
      persist();
      await launchPlanSeed(validation.value);
      return {
        content: [
          {
            type: "text",
            text: "Plan accepted and is being persisted to its mission.",
          },
        ],
        details: { state },
      };
    }

    if (action === "retry-plan") {
      const validPhase =
        state.phase === "planning" || state.phase === "planning-failed";
      if (!validPhase || state.activeRun)
        throw new Error("retry-plan requires an idle or failed planning phase.");
      await launchPlanner(true);
      return {
        content: [{ type: "text", text: "Plan-unit retry launched." }],
        details: { state },
      };
    }

    if (action === "replan") {
      if (
        state.phase !== "awaiting-execution-correction" &&
        state.phase !== "awaiting-review-decision" &&
        state.phase !== "awaiting-integration-correction"
      )
        throw new Error(
          "replan requires a review or integration decision gate.",
        );
      state = { ...state, phase: "planning", updatedAt: now() };
      persist();
      await launchPlanner(true);
      return {
        content: [{ type: "text", text: "Corrective plan-unit launched." }],
        details: { state },
      };
    }

    const phasesForAction: Partial<Record<string, Phase[]>> = {
      go: ["awaiting-go"],
      execute: ["executing", "awaiting-execution-correction"],
      integrate: ["integrating"],
      review: ["reviewing"],
      verify: ["verifying"],
      close: ["closing"],
    };
    const allowedPhases = phasesForAction[action];
    if (allowedPhases) {
      if (!allowedPhases.includes(state.phase))
        throw new Error(
          `${action} is only valid during ${allowedPhases.join(" or ")}.`,
        );
      const kind: WorkflowAction =
        action === "go" ? "execute" : (action as WorkflowAction);
      state = {
        ...state,
        phase: kind === "execute" ? "executing" : state.phase,
        updatedAt: now(),
      };
      persist();
      await launchWorkflow(kind);
      return {
        content: [{ type: "text", text: `${kind} workflow launched.` }],
        details: { state },
      };
    }

    throw new Error(`Unknown complex-work action: ${action}.`);
  };

  pi.registerTool<typeof controlParams, { state: ComplexWorkState | null }>({
    name: CONTROL_TOOL,
    label: "Complex Work Control",
    description:
      "Records research and plans, controls user decisions, and launches deterministic complex-work phases.",
    promptSnippet: "Advance or inspect the active complex-work lifecycle",
    promptGuidelines: [
      "Complex-work automatically runs parallel research, synthesis, plan compilation, execution, integration, and review. Do not reproduce those orchestration steps.",
      "Use resolve-research only after the user answers an unresolved authority decision. Use GO and verification only after explicit user approval.",
      "Manual research-complete and plan-complete are recovery overrides, not the normal path.",
      "Do not launch complex-work workflow paths yourself; complex_work_control owns top-level execution mechanics.",
    ],
    parameters: controlParams,
    execute: (_toolCallId, params) => executeControlAction(params),
  });

  const commandActions = {
    go: "Start the next approved execution wave",
    execute: "Retry the execution phase",
    integrate: "Retry integration",
    review: "Retry review",
    verify: "Record user verification and close the wave",
    close: "Retry wave closure",
    replan: "Start corrective planning",
    "retry-research": "Retry research or synthesis",
    "retry-plan": "Retry planning",
    finish: "Finish the session",
    abandon: "Abandon the session",
  } as const;

  for (const [action, description] of Object.entries(commandActions)) {
    pi.registerCommand(`complex-work-${action}`, {
      description,
      handler: async (_args, ctx) => {
        if (!state || state.phase === "inactive" || !isRootSession) {
          ctx.ui.notify(
            "No active complex-work session in this root session.",
            "error",
          );
          return;
        }
        try {
          const result = await executeControlAction({ action });
          const content = result.content[0];
          ctx.ui.notify(
            content?.type === "text" ? content.text : "Done",
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

  pi.registerCommand("complex-work-status", {
    description: "Show complex-work status and phase history",
    handler: (_args, ctx) => {
      if (!state || state.phase === "inactive" || !isRootSession) {
        ctx.ui.notify(
          "No active complex-work session in this root session.",
          "error",
        );
        return Promise.resolve();
      }
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
    },
  });

  pi.on("session_start", (_event, ctx) => {
    const replayed = replayComplexWorkStates(ctx.sessionManager.getBranch());
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
    const input = event.input as { workflowScriptPath?: unknown };
    if (input.workflowScriptPath) {
      return {
        block: true,
        reason:
          "Complex-work top-level workflow launches are controller-owned. Use complex_work_control instead of workflowScriptPath.",
      };
    }
  });

  pi.registerCommand("complex-work", {
    description: "Start a research-first complex-work session",
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
        ctx.ui.notify("Complex-work requires a persisted Pi session.", "error");
        return Promise.resolve();
      }
      isRootSession = true;
      state = {
        request,
        phase: "researching",
        rootSessionFile,
        projectCwd: ctx.cwd,
        updatedAt: now(),
      };
      persist();
      enableControl();
      pi.setSessionName(`Complex work: ${request.slice(0, 72)}`);
      try {
        await launchResearch(true);
        ctx.ui.notify(
          "Complex-work launched four parallel research scouts and synthesis.",
          "info",
        );
      } catch (error) {
        ctx.ui.notify(
          `Research launch failed but remains retryable: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
      }
    },
  });
}
