/** Durable mission records and fixed user-action transitions. Never interpret model findings. */
import { createHash, randomUUID } from "node:crypto";
import { constants, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, parse, relative, resolve, sep } from "node:path";

export const STAGES = ["gather-info", "research", "plan", "implementation", "review", "tests", "merge", "end"] as const;
export type Stage = typeof STAGES[number];
export type Action = "next" | "back" | "retry" | "end" | "pause" | "resume" | "cancel" | "reopen" | "merge";
export interface ModelUse { provider: string; model: string }
export interface StageRun {
  id: string;
  stage: Stage | "title";
  attempt: number;
  agent: string;
  modelsUsed: ModelUse[];
  status: "dispatching" | "running" | "completed" | "failed" | "cancelled";
  report: string;
  runnerOutput?: string;
  candidateHead?: string;
  reportDigest?: string;
  startedAt: string;
  finishedAt?: string;
  runnerId?: string;
  runnerDir?: string;
  error?: string;
  stale?: boolean;
  delegates?: { agent: string; model?: string; runId?: string }[];
}
export interface Transition {
  id: string;
  date: string;
  at: string;
  from: Stage | null;
  to: Stage;
  action: Action | "create";
  source: "command" | "tui";
  reason: string;
  sessionId: string;
  attempt: number;
  stageRunIds: string[];
  agentsUsed: { runId: string; agent: string; modelsUsed: ModelUse[] }[];
  reportPaths: string[];
  approvedReports: string[];
  featureAccepted?: boolean;
  stale?: boolean;
}
export interface MissionWorktree {
  directory: string;
  branch: string;
  baseBranch: string;
  baseCommit: string;
  validatedHead?: string;
  mergeCommit?: string;
  mergeAttempt?: { candidateHead: string; sourceHead: string; status: "attempting" | "failed" | "merged"; error?: string };
}
export interface TaskState {
  schemaVersion: 1;
  taskId: string;
  workflow: "complex-task";
  title: string;
  createdAt: string;
  updatedAt: string;
  currentState: Stage;
  executionStatus: "ready" | "running" | "awaiting-user" | "paused" | "failed" | "ended" | "cancelled";
  revision: number;
  outcome: null | "ended-early" | "validated" | "cancelled" | "merged";
  worktree?: MissionWorktree;
  /** Removed from mission menus; files, code, and Git isolation are retained. */
  removedAt?: string;
  ownerSessionId?: string;
  feedback: string;
  stageRuns: StageRun[];
  history: Transition[];
}
export interface TaskRecord { folder: string; state: TaskState }

const active = (run: StageRun) => run.status === "dispatching" || run.status === "running";
const index = (stage: Stage) => STAGES.indexOf(stage);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clone = <T>(value: T): T => structuredClone(value);

// Check every component, including the project root; never follow a symlink.
export function safePath(path: string): void {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error(`Symlink refused: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

function fileIn(folder: string, name: string): string {
  if (!name || basename(name) !== name || name === "." || name === ".." || name.includes("\\")) {
    throw new Error("Invalid artifact filename");
  }
  const path = join(folder, name);
  safePath(path);
  return path;
}

function regularFile(path: string, nonempty = false): void {
  safePath(path);
  const stat = lstatSync(path);
  if (!stat.isFile() || (nonempty && stat.size === 0)) throw new Error(`Missing or empty report: ${path}`);
}

function invalidate(state: TaskState, from: Stage): void {
  if (state.worktree && index(from) < index("merge")) state.worktree.validatedHead = undefined;
  for (const run of state.stageRuns) {
    if (run.stage !== "title" && index(run.stage) >= index(from)) run.stale = true;
  }
  for (const event of state.history) {
    if (event.action !== "create" && event.from !== null && index(event.from) >= index(from)) event.stale = true;
  }
}

function event(state: TaskState, action: Action | "create", from: Stage | null, source: "command" | "tui", reason: string, sessionId: string, runs: StageRun[]): Transition {
  const date = new Date().toISOString();
  return {
    id: randomUUID(), date, at: date, from, to: state.currentState, action, source, reason, sessionId,
    attempt: Math.max(0, ...runs.map(run => run.attempt)),
    stageRunIds: runs.map(run => run.id),
    agentsUsed: runs.flatMap(run => [
      { runId: run.id, agent: run.agent, modelsUsed: clone(run.modelsUsed) },
      ...(run.delegates ?? []).filter(delegate => delegate.agent !== run.agent).map(delegate => ({
        runId: delegate.runId ?? "unknown", agent: delegate.agent,
        modelsUsed: delegate.model ? [modelIdentity(delegate.model)] : [],
      })),
    ]),
    reportPaths: runs.map(run => run.report).filter(Boolean),
    approvedReports: action === "next" || action === "end" ? runs.filter(run => run.status === "completed").map(run => run.report) : [],
    ...(action === "next" && from === "implementation" ? { featureAccepted: true } : {}),
  };
}

function modelIdentity(model: string): ModelUse {
  const slash = model.indexOf("/");
  return slash < 0 ? { provider: "unknown", model } : { provider: model.slice(0, slash), model: model.slice(slash + 1) };
}

export class TaskStore {
  readonly projectRoot: string;
  private readonly tasksDir: string;

  constructor(projectRoot: string) {
    this.projectRoot = resolve(projectRoot);
    safePath(this.projectRoot);
    if (!lstatSync(this.projectRoot).isDirectory()) throw new Error("Project root must be a directory");
    this.tasksDir = join(this.projectRoot, "docs", "tasks");
  }

  create(title: string, input: string, titleRun: StageRun, sessionId: string, worktree?: MissionWorktree): TaskRecord {
    if (!sessionId || titleRun.stage !== "title" || active(titleRun)) throw new Error("Invalid title run or session");
    const taskId = titleRun.id;
    if (!uuid.test(taskId)) throw new Error("Invalid bootstrap task ID");
    const existing = this.list().find(task => task.state.taskId === taskId);
    if (existing) return existing;
    const date = new Date(titleRun.startedAt).toISOString();
    const slug = title.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64).replace(/-$/, "") || "task";
    const hash = createHash("sha256").update(taskId).digest("hex").slice(0, 7);
    for (const directory of [join(this.projectRoot, "docs"), this.tasksDir]) {
      safePath(directory);
      if (!existsSync(directory)) mkdirSync(directory);
      if (!lstatSync(directory).isDirectory()) throw new Error("Task parent must be a directory");
    }
    const folder = join(this.tasksDir, `${date.slice(0, 10)}-${slug}-${hash}`);
    safePath(folder);
    if (existsSync(folder)) throw new Error("Task folder exists without matching state. Inspect before recovery.");
    const staging = fileIn(this.tasksDir, `.creating-${taskId}`);
    if (!existsSync(staging)) mkdirSync(staging);
    if (!lstatSync(staging).isDirectory()) throw new Error("Task staging path must be a directory");
    const state: TaskState = {
      schemaVersion: 1, taskId, workflow: "complex-task", title, createdAt: date, updatedAt: date,
      currentState: "gather-info", executionStatus: "ready", revision: 0, outcome: null,
      ownerSessionId: sessionId, feedback: "", stageRuns: [clone(titleRun)], history: [],
      ...(worktree ? { worktree: clone(worktree) } : {}),
    };
    state.history.push(event(state, "create", null, "tui", "Task created", sessionId, state.stageRuns));
    this.validate(state, staging);
    const inputPath = fileIn(staging, "initial-input.md");
    if (existsSync(inputPath) && readFileSync(inputPath, "utf8") !== input) throw new Error("Staged task input differs. Inspect before recovery.");
    if (!existsSync(inputPath)) writeFileSync(inputPath, input, { flag: "wx", mode: 0o600 });
    this.write(staging, state);
    renameSync(staging, folder);
    return { folder, state };
  }

  list(): TaskRecord[] {
    safePath(this.tasksDir);
    if (!existsSync(this.tasksDir)) return [];
    const records: TaskRecord[] = [];
    for (const name of readdirSync(this.tasksDir).sort()) {
      if (name.startsWith(".")) continue;
      const folder = fileIn(this.tasksDir, name);
      if (!lstatSync(folder).isDirectory()) continue;
      const path = fileIn(folder, "state.json");
      if (!existsSync(path)) continue;
      regularFile(path);
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      let state: TaskState;
      try { state = JSON.parse(readFileSync(fd, "utf8")); }
      catch (error) { throw new Error(`Task state unreadable: ${path}. ${String(error)}`); }
      finally { closeSync(fd); }
      this.validate(state, folder);
      if (!state.removedAt) records.push({ folder, state });
    }
    return records;
  }

  load(taskId: string): TaskRecord {
    if (!uuid.test(taskId)) throw new Error("Invalid task ID");
    const matches = this.list().filter(task => task.state.taskId === taskId);
    if (matches.length !== 1) throw new Error(`Task missing or duplicated: ${taskId}`);
    return matches[0];
  }

  remove(taskId: string, expectedRevision: number): void {
    this.update(taskId, expectedRevision, state => {
      if (state.stageRuns.some(active) || !["ended", "cancelled"].includes(state.executionStatus)) throw new Error("Stop and settle mission execution before removing it.");
      if (state.worktree?.mergeAttempt?.status === "attempting") throw new Error("Resolve the pending merge transaction before removing this mission.");
      state.removedAt = new Date().toISOString();
    });
  }

  // Trusted controller API: callers authenticate the session before updating runner metadata.
  update(taskId: string, expectedRevision: number, mutate: (state: TaskState) => void): TaskRecord {
    const task = this.load(taskId);
    const lock = fileIn(task.folder, ".mutation-lock");
    // A crashed holder requires explicit reconciliation; never expire ownership.
    try { mkdirSync(lock); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Task mutation busy");
      throw error;
    }
    try {
      const current = this.load(taskId);
      if (current.folder !== task.folder) throw new Error("Task folder changed");
      if (current.state.revision !== expectedRevision) throw new Error("Stale task revision");
      const state = clone(current.state);
      mutate(state);
      if (state.taskId !== taskId || state.createdAt !== current.state.createdAt) throw new Error("Task identity is immutable");
      if (current.state.stageRuns.some(active) && state.ownerSessionId !== current.state.ownerSessionId) throw new Error("Live run belongs to another session");
      state.revision = current.state.revision + 1;
      state.updatedAt = new Date().toISOString();
      this.validate(state, task.folder);
      this.write(task.folder, state);
      return { folder: task.folder, state };
    } finally { rmdirSync(lock); }
  }

  transition(taskId: string, expectedRevision: number, action: Action, target: Stage | undefined, reason: string, source: "command" | "tui", sessionId: string, validatedHead?: string): TaskRecord {
    return this.update(taskId, expectedRevision, state => {
      this.claim(state, sessionId);
      if (state.stageRuns.some(active) || state.executionStatus === "running") throw new Error("Stop and finish the live run before transitioning");
      if (source !== "command" && source !== "tui") throw new Error("Invalid transition source");
      const from = state.currentState;
      const runs = state.stageRuns.filter(run => run.stage === from && !run.stale);
      const latest = runs.at(-1);
      const completed = () => {
        if (state.executionStatus !== "awaiting-user" || latest?.status !== "completed") throw new Error("Current completed report required");
        const report = fileIn(this.load(taskId).folder, latest.report);
        regularFile(report, true);
        if (latest.reportDigest && createHash("sha256").update(readFileSync(report)).digest("hex") !== latest.reportDigest) throw new Error("Completed findings changed. Retry this stage rather than approving altered evidence.");
      };
      const terminal = state.executionStatus === "ended" || state.executionStatus === "cancelled";
      if (terminal && action !== "reopen" && action !== "cancel") throw new Error("Terminal task requires reopen");
      if (action === "next") {
        completed();
        const next = STAGES[index(from) + 1];
        if (!next || (target !== undefined && target !== next)) throw new Error("Next must be adjacent");
        state.currentState = next;
        if (next === "merge") {
          if (!state.worktree || !validatedHead || !/^[a-f\d]{40,64}$/i.test(validatedHead)) throw new Error("A clean, committed mission worktree is required before test acceptance.");
          state.worktree.validatedHead = validatedHead;
        }
        state.executionStatus = next === "merge" ? "awaiting-user" : "ready";
        state.outcome = null;
      } else if (action === "merge") {
        if (from !== "merge" || !state.worktree?.mergeCommit || state.worktree.mergeAttempt?.status !== "merged") throw new Error("Explicit merge proof is required before closing.");
        state.currentState = "end";
        state.executionStatus = "ended";
        state.outcome = "merged";
      } else if (action === "back" || action === "reopen") {
        if (action === "reopen" && !terminal) throw new Error("Reopen requires a terminal task");
        if (!target || !STAGES.includes(target) || target === "end" || index(target) >= index(from) || !state.history.some(entry => entry.to === target)) throw new Error("Target must be an earlier visited stage");
        invalidate(state, target);
        state.currentState = target;
        state.executionStatus = target === "merge" ? "awaiting-user" : "ready";
        state.outcome = null;
      } else if (action === "retry") {
        if (["merge", "end"].includes(from) || (target !== undefined && target !== from)) throw new Error("Retry requires the same work stage");
        invalidate(state, from);
        state.executionStatus = "ready";
      } else if (action === "end") {
        if (!["implementation", "review", "tests", "merge"].includes(from) || (target !== undefined && target !== "end")) throw new Error("Cannot end from this stage");
        if (reason === "validated") throw new Error("Test acceptance leads to an explicit merge gate, not automatic closure.");
        state.currentState = "end";
        state.executionStatus = "ended";
        state.outcome = "ended-early";
      } else if (action === "pause") {
        if (from === "end" || state.executionStatus === "paused") throw new Error("Cannot pause this task");
        state.executionStatus = "paused";
      } else if (action === "resume") {
        if (state.executionStatus !== "paused" || from === "end") throw new Error("Task is not paused");
        invalidate(state, from);
        state.executionStatus = from === "merge" ? "awaiting-user" : "ready";
      } else if (action === "cancel") {
        state.currentState = "end";
        state.executionStatus = "cancelled";
        state.outcome = "cancelled";
      } else {
        throw new Error("Unknown action");
      }
      state.feedback = reason;
      state.history.push(event(state, action, from, source, reason, sessionId, runs));
    });
  }

  beginRun(taskId: string, expectedRevision: number, agent: string, sessionId: string): { task: TaskRecord; run: StageRun } {
    let run!: StageRun;
    const task = this.update(taskId, expectedRevision, state => {
      this.claim(state, sessionId);
      if (!agent || ["merge", "end"].includes(state.currentState) || !["ready", "awaiting-user"].includes(state.executionStatus) || state.stageRuns.some(active)) throw new Error("Stage is not ready for a run");
      const stage = state.currentState;
      const attempt = Math.max(0, ...state.stageRuns.filter(previous => previous.stage === stage).map(previous => previous.attempt)) + 1;
      const report = `${String(index(stage) + 1).padStart(2, "0")}-${stage}-attempt-${String(attempt).padStart(3, "0")}.md`;
      const runnerOutput = report.replace(/\.md$/, "-runner-output.md");
      const folder = this.load(taskId).folder;
      if ([report, runnerOutput].some(name => existsSync(fileIn(folder, name)))) throw new Error("Reserved report already exists");
      invalidate(state, stage);
      run = { id: randomUUID(), stage, attempt, agent, modelsUsed: [], status: "dispatching", report,
        runnerOutput, startedAt: new Date().toISOString() };
      state.stageRuns.push(run);
      state.executionStatus = "running";
    });
    return { task, run };
  }

  finishRun(taskId: string, runId: string, status: "completed" | "failed" | "cancelled", error?: string, candidateHead?: string): TaskRecord {
    const task = this.load(taskId);
    return this.update(taskId, task.state.revision, state => {
      const run = state.stageRuns.find(candidate => candidate.id === runId);
      const latest = state.stageRuns.filter(candidate => candidate.stage === state.currentState).at(-1);
      if (!run || run !== latest || run.stage !== state.currentState || run.stale || !active(run)) throw new Error("Run is not the current live attempt");
      if (!["completed", "failed", "cancelled"].includes(status)) throw new Error("Invalid completion status");
      if (status === "completed") {
        const report = fileIn(task.folder, run.report);
        regularFile(report, true);
        run.reportDigest = createHash("sha256").update(readFileSync(report)).digest("hex");
        if (candidateHead) run.candidateHead = candidateHead;
      }
      run.status = status;
      run.finishedAt = new Date().toISOString();
      if (error !== undefined) run.error = error;
      state.executionStatus = status === "completed" ? "awaiting-user" : status === "failed" ? "failed" : "ready";
    });
  }

  private claim(state: TaskState, sessionId: string): void {
    if (!sessionId) throw new Error("Session ID required");
    if (state.stageRuns.some(active) && state.ownerSessionId !== sessionId) throw new Error("Live run belongs to another session");
    state.ownerSessionId = sessionId;
  }

  private validate(state: TaskState, folder: string): void {
    const path = relative(this.tasksDir, folder);
    if (!path || path.startsWith("..") || path.includes(sep)) throw new Error("Task folder escaped storage root");
    safePath(folder);
    if (state.schemaVersion !== 1 || state.workflow !== "complex-task" || !uuid.test(state.taskId) || !STAGES.includes(state.currentState) || !Number.isSafeInteger(state.revision) || state.revision < 0 || !Array.isArray(state.stageRuns) || !Array.isArray(state.history)) throw new Error("Invalid task state");
    if (!["ready", "running", "awaiting-user", "paused", "failed", "ended", "cancelled"].includes(state.executionStatus) || ![null, "ended-early", "validated", "cancelled", "merged"].includes(state.outcome)) throw new Error("Invalid execution state");
    if (state.worktree) {
      const worktree = state.worktree;
      if (worktree.branch !== `complex-work/${state.taskId}` || !worktree.baseBranch || !/^[a-f\d]{40,64}$/i.test(worktree.baseCommit) || !worktree.directory || resolve(worktree.directory) !== worktree.directory) throw new Error("Invalid mission worktree record");
      safePath(worktree.directory);
    }
    const ids = new Set<string>();
    for (const run of state.stageRuns) {
      if (!run.id || ids.has(run.id) || (run.stage !== "title" && !STAGES.includes(run.stage)) || ["merge", "end"].includes(run.stage) || !Number.isSafeInteger(run.attempt) || run.attempt < 1 || !Array.isArray(run.modelsUsed) || !["dispatching", "running", "completed", "failed", "cancelled"].includes(run.status)) throw new Error("Invalid stage run");
      ids.add(run.id);
      if (run.report) fileIn(folder, run.report);
      if (run.runnerOutput) fileIn(folder, run.runnerOutput);
      if (run.stage !== "title" && !run.report) throw new Error("Run report required");
      if (run.modelsUsed.some(model => typeof model.provider !== "string" || typeof model.model !== "string")) throw new Error("Invalid model metadata");
    }
    const live = state.stageRuns.filter(active);
    if (live.length > 1 || live.some(run => run.stage !== state.currentState || run.stale) || (live.length > 0 && state.executionStatus !== "running")) throw new Error("Invalid live run ownership");
  }

  private write(folder: string, state: TaskState): void {
    const destination = fileIn(folder, "state.json");
    const temporary = fileIn(folder, `.state-${randomUUID()}.tmp`);
    const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      try {
        writeFileSync(fd, `${JSON.stringify(state, null, 2)}\n`);
        fsyncSync(fd);
      } finally { closeSync(fd); }
      safePath(destination);
      renameSync(temporary, destination);
      const directory = openSync(dirname(destination), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { fsyncSync(directory); } finally { closeSync(directory); }
    } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  }
}
