/** User-directed mission controller. Agents write findings; code owns task state. */
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { STAGES, TaskStore, type Action, type ModelUse, type Stage, type StageRun, type TaskRecord, type MissionWorktree } from "./state.ts";
import { MissionWorktrees, type MergeApproval } from "./worktrees.ts";
import { SubagentRunner, type RunnerReceipt, type RunnerSnapshot, type RuntimeAgent } from "./runner.ts";
import { INTERVIEW_BINDING, type InterviewBinding } from "./interview-protocol.ts";

interface MissionServices {
  prepareInterview?: (task: TaskRecord, run: StageRun) => InterviewBinding;
  planningModels?: () => Promise<string>;
  cancelInterview?: (task: TaskRecord, run: StageRun) => void;
}

interface Bootstrap {
  id: string;
  createdAt: string;
  input: string;
  sessionId: string;
  status: "dispatching" | "running" | "failed" | "completed";
  receipt?: RunnerReceipt;
  error?: string;
  taskId?: string;
  worktree?: MissionWorktree;
}

const AGENTS: Record<Exclude<Stage, "merge" | "end">, string> = {
  "gather-info": "complex-gather-info",
  research: "complex-research",
  plan: "complex-plan",
  implementation: "complex-implementation",
  review: "complex-review",
  tests: "complex-tests",
};

export function activeRun(task: TaskRecord): StageRun | undefined {
  return task.state.stageRuns.find(run => run.status === "running" || run.status === "dispatching");
}

function modelsUsed(snapshot: RunnerSnapshot, previous: ModelUse[] = []): ModelUse[] {
  const models = snapshot.agents.map(agent => agent.model).filter((model): model is string => Boolean(model));
  const observed = [...new Set(models)].map(model => {
    const slash = model.indexOf("/");
    return slash < 0 ? { provider: "unknown", model } : { provider: model.slice(0, slash), model: model.slice(slash + 1) };
  });
  return [...new Map([...previous, ...observed].map(model => [`${model.provider}/${model.model}`, model])).values()];
}

function mergeAgents(previous: RuntimeAgent[] = [], observed: RuntimeAgent[]): RuntimeAgent[] {
  return [...new Map([...previous, ...observed].map(agent => [JSON.stringify([agent.runId, agent.agent, agent.model]), agent])).values()];
}

function readJson<T>(file: string): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (error) {
    throw new Error(`Cannot read ${file}: ${String(error)}`);
  }
}

function executionAgents(run: StageRun) {
  return [
    { runId: run.id, agent: run.agent, modelsUsed: run.modelsUsed },
    ...(run.delegates ?? []).map(agent => ({ runId: agent.runId ?? "unknown", agent: agent.agent,
      modelsUsed: modelsUsed({ state: "complete", settled: false, agents: [agent] }) })),
  ];
}

function receiptOf(run: StageRun): RunnerReceipt {
  if (!run.runnerId || !run.runnerDir) throw new Error("Dispatch identity unresolved. Inspect /subagents-fleet; do not retry or clear ownership blindly.");
  return { id: run.runnerId, directory: run.runnerDir };
}

function stagePacket(task: TaskRecord, run: StageRun, binding?: InterviewBinding, catalog = ""): string {
  const reports = task.state.stageRuns.filter(item => item.status === "completed" && !item.stale && item.stage !== "title");
  const inputs = reports.map(item => join(task.folder, item.report));
  const previousAttempt = task.state.stageRuns.filter(item => item.stage === run.stage && item.id !== run.id && item.status === "completed").at(-1);
  return [
    `Mission: ${task.state.title}. Stage: ${run.stage}.`,
    `Read initial orders: ${join(task.folder, "initial-input.md")}.`,
    inputs.length ? `Read relevant handoffs: ${inputs.join(", ")}.` : "No prior handoffs.",
    previousAttempt ? `Historical attempt (not approval): ${join(task.folder, previousAttempt.report)}.` : "",
    `Write findings: ${join(task.folder, run.report)}. Keep it short.`,
    task.state.feedback ? `User orders: ${task.state.feedback}` : "",
    "Never edit state.json or workflow-owned records. Never advance or merge the workflow. Never push or publish.",
    "Work only in this mission's Git worktree. Code-writing agents must commit their own scoped changes before finishing; do not amend others' commits or stage unrelated files. Pass this rule to every delegate.",
    "Coordinate delegated writers: use disjoint scopes and serialize staging/commits in the shared worktree. Never create another worktree or change branches without explicit user permission.",
    "Findings and interview artifacts live at the absolute paths above, outside the code worktree; do not commit them.",
    "Questions? Call interview with async:false; wait for answers. Batch questions, give recommendations with rationale, and record Q&A in your findings.",
    "An interview clarifies this stage; it never approves a transition. Cancelled, unavailable, or timed out? Report blockers and stop without guessing.",
    binding ? `For every delegate, pass this unchanged as extensionBindings: ${JSON.stringify({ [INTERVIEW_BINDING]: binding })}.` : "",
    catalog,
  ].filter(Boolean).join("\n");
}

export class MissionController {
  readonly store: TaskStore;
  private readonly bootstrapRoot: string;
  private readonly worktrees: MissionWorktrees;

  constructor(readonly root: string, private readonly runner: SubagentRunner, readonly sessionId: string, private readonly services: MissionServices = {}) {
    this.store = new TaskStore(root);
    this.worktrees = new MissionWorktrees(root);
    this.bootstrapRoot = join(root, "docs", "tasks", ".bootstrap");
  }

  private prepareBootstrapRoot(): void {
    for (const folder of [join(this.root, "docs"), join(this.root, "docs", "tasks"), this.bootstrapRoot]) {
      if (existsSync(folder) && lstatSync(folder).isSymbolicLink()) throw new Error(`Refusing symlink: ${folder}`);
      mkdirSync(folder, { recursive: true });
    }
  }

  private saveBootstrap(bootstrap: Bootstrap): void {
    const file = join(this.bootstrapRoot, `${bootstrap.id}.json`);
    const temporary = `${file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(bootstrap, null, 2) + "\n", { mode: 0o600 });
    renameSync(temporary, file);
  }

  bootstraps(): Bootstrap[] {
    if (!existsSync(this.bootstrapRoot)) return [];
    return readdirSync(this.bootstrapRoot).filter(name => /^[\da-f-]+\.json$/.test(name))
      .map(name => readJson<Bootstrap>(join(this.bootstrapRoot, name)));
  }

  private assertIdle(exceptTaskId?: string): void {
    const busy = this.store.list().find(task => task.state.taskId !== exceptTaskId
      && (activeRun(task) || (task.state.currentState !== "end" && task.state.executionStatus !== "paused")));
    if (busy) throw new Error(`Mission ${busy.state.taskId} is active. Finish or pause it first.`);
    const pending = this.bootstraps().find(item => item.status === "running" || item.status === "dispatching");
    if (pending) throw new Error(`Title dispatch ${pending.id} is pending. Refresh title evidence in mission control before starting another task.`);
  }

  async start(input: string): Promise<string> {
    if (!input.trim()) throw new Error("Orders missing. Enter a task description in the mission-control input before starting.");
    await this.runner.available(this.sessionId);
    this.assertIdle();
    const id = randomUUID();
    const worktree = this.worktrees.prepare(id);
    this.prepareBootstrapRoot();
    const bootstrap: Bootstrap = {
      id, createdAt: new Date().toISOString(), input: input.trim(),
      sessionId: this.sessionId, status: "dispatching", worktree,
    };
    this.saveBootstrap(bootstrap);
    const report = join(this.bootstrapRoot, `${bootstrap.id}.md`);
    let dispatchStarted = false;
    try {
      this.worktrees.ensure(worktree);
      dispatchStarted = true;
      bootstrap.receipt = await this.runner.launch("complex-title", `Name this mission. Return one short title only.\n${input}`, worktree.directory, report);
      bootstrap.status = "running";
      this.saveBootstrap(bootstrap);
      return bootstrap.id;
    } catch (error) {
      bootstrap.error = String(error);
      if (!dispatchStarted) bootstrap.status = "failed";
      this.saveBootstrap(bootstrap);
      throw error;
    }
  }

  private assertOwner(task: TaskRecord): void {
    if (activeRun(task) && task.state.ownerSessionId !== this.sessionId) {
      throw new Error("Another Pi session owns this active stage. Resume its session to control the runner.");
    }
  }

  async launch(taskId: string): Promise<TaskRecord> {
    await this.runner.available(this.sessionId);
    this.assertIdle(taskId);
    const task = this.store.load(taskId);
    if (["merge", "end"].includes(task.state.currentState)) throw new Error("This stage has no agent run. Choose an explicit action.");
    const worktree = this.worktree(task);
    this.worktrees.verify(worktree);
    const stage = task.state.currentState as Exclude<Stage, "merge" | "end">;
    const catalog = task.state.currentState === "plan" ? await this.services.planningModels?.() ?? "" : "";
    const { task: reserved, run } = this.store.beginRun(taskId, task.state.revision, AGENTS[stage], this.sessionId);
    try {
      const binding = this.services.prepareInterview?.(reserved, run);
      const receipt = await this.runner.launch(run.agent, stagePacket(reserved, run, binding, catalog), worktree.directory,
        join(task.folder, run.report), binding ? { [INTERVIEW_BINDING]: binding } : undefined);
      const current = this.store.load(taskId);
      return this.store.update(taskId, current.state.revision, state => {
        const execution = state.stageRuns.find(item => item.id === run.id)!;
        execution.runnerId = receipt.id;
        execution.runnerDir = receipt.directory;
        execution.status = "running";
      });
    } catch (error) {
      const current = this.store.load(taskId);
      this.store.update(taskId, current.state.revision, state => {
        state.stageRuns.find(item => item.id === run.id)!.error = String(error);
      });
      throw error;
    }
  }

  async reconcile(taskId: string): Promise<TaskRecord> {
    let task = this.store.load(taskId);
    const run = activeRun(task);
    if (!run) return task;
    const receipt = receiptOf(run);
    const observed = this.runner.snapshot(receipt.directory, receipt.id);
    if (!observed.settled && task.state.ownerSessionId !== this.sessionId) return task;
    const snapshot = observed.settled ? observed : await this.runner.inspect(receipt);
    task = this.store.update(taskId, task.state.revision, state => {
      const execution = state.stageRuns.find(item => item.id === run.id)!;
      execution.modelsUsed = modelsUsed({ ...snapshot, agents: snapshot.agents.filter(agent => agent.agent === run.agent) }, execution.modelsUsed);
      execution.delegates = mergeAgents(execution.delegates, snapshot.agents.filter(agent => agent.agent !== run.agent));
    });
    if (!snapshot.settled) return task;
    const runnerOutput = this.runner.finalOutput(receiptOf(run));
    if (run.runnerOutput && runnerOutput !== undefined && !existsSync(join(task.folder, run.runnerOutput))) {
      writeFileSync(join(task.folder, run.runnerOutput), runnerOutput, { flag: "wx", mode: 0o600 });
    }
    let status: "completed" | "cancelled" | "failed" = snapshot.state === "complete" ? "completed" : snapshot.state === "stopped" || snapshot.state === "paused" ? "cancelled" : "failed";
    let error = snapshot.error;
    const report = join(task.folder, run.report);
    if (status === "completed" && (!existsSync(report) || !statSync(report).isFile() || statSync(report).size === 0)) {
      status = "failed";
      error = "Agent stopped without its findings file. Retry after inspecting the runner.";
    }
    let candidateHead: string | undefined;
    if (status === "completed" && task.state.worktree) {
      try { candidateHead = this.worktrees.candidateHead(task.state.worktree); }
      catch (problem) { status = "failed"; error = `Candidate is not ready for approval: ${String(problem)}`; }
    }
    return this.store.finishRun(taskId, run.id, status, error, candidateHead);
  }

  recordCompletionMetadata(runnerId: string): void {
    const agents = this.runner.completionAgents(runnerId);
    if (!agents.length) return;
    for (const task of this.store.list()) {
      if (task.state.ownerSessionId !== this.sessionId) continue;
      const run = task.state.stageRuns.find(item => item.runnerId === runnerId);
      if (!run) continue;
      this.store.update(task.state.taskId, task.state.revision, state => {
        const execution = state.stageRuns.find(item => item.id === run.id)!;
        execution.modelsUsed = modelsUsed({ state: "complete", settled: false, agents: agents.filter(agent => agent.agent === run.agent) }, execution.modelsUsed);
        execution.delegates = mergeAgents(execution.delegates, agents.filter(agent => agent.agent !== run.agent));
        for (const transition of state.history) {
          if (transition.stageRunIds.includes(run.id)) transition.agentsUsed = state.stageRuns
            .filter(item => transition.stageRunIds.includes(item.id)).flatMap(executionAgents);
        }
      });
    }
  }

  async reconcileBootstraps(): Promise<TaskRecord[]> {
    const created: TaskRecord[] = [];
    for (const bootstrap of this.bootstraps()) {
      if (bootstrap.sessionId !== this.sessionId || bootstrap.status !== "running" || !bootstrap.receipt) continue;
      const snapshot = await this.runner.inspect(bootstrap.receipt);
      if (!snapshot.settled) continue;
      if (snapshot.state !== "complete") {
        bootstrap.status = "failed";
        bootstrap.error = snapshot.error ?? `Title agent ${snapshot.state}. Start again with explicit orders.`;
        this.saveBootstrap(bootstrap);
        continue;
      }
      const task = this.materialize(bootstrap, snapshot);
      created.push(task);
    }
    return created;
  }

  private materialize(bootstrap: Bootstrap, snapshot: RunnerSnapshot): TaskRecord {
    const report = join(this.bootstrapRoot, `${bootstrap.id}.md`);
    if (!existsSync(report)) throw new Error("Title report missing. Task creation is blocked.");
    const title = readFileSync(report, "utf8").trim().split(/\r?\n/)[0].replace(/^#+\s*|^["']|["']$/g, "").slice(0, 120);
    if (!title) throw new Error("Title agent returned empty orders. Task creation is blocked.");
    const titleRun: StageRun = {
      id: bootstrap.id, stage: "title", attempt: 1, agent: "complex-title", modelsUsed: modelsUsed(snapshot),
      status: "completed", report: "00-title.md", startedAt: bootstrap.createdAt,
      finishedAt: new Date().toISOString(), runnerId: bootstrap.receipt!.id, runnerDir: bootstrap.receipt!.directory,
    };
    const task = bootstrap.taskId ? this.store.load(bootstrap.taskId) : this.store.create(title, bootstrap.input, titleRun, this.sessionId, bootstrap.worktree);
    const titleFile = join(task.folder, "00-title.md");
    if (!existsSync(titleFile)) writeFileSync(titleFile, title + "\n", { flag: "wx", mode: 0o600 });
    bootstrap.taskId = task.state.taskId;
    bootstrap.status = "completed";
    this.saveBootstrap(bootstrap);
    return task;
  }

  private worktree(task: TaskRecord): MissionWorktree {
    if (!task.state.worktree) throw new Error("This legacy mission has no isolated worktree. Its existing reports and runners are preserved; start a new mission from a clean branch rather than launching a replacement writer in the original checkout.");
    return task.state.worktree;
  }

  async remove(taskId: string, revision: number): Promise<void> {
    let task = this.store.load(taskId);
    if (task.state.revision !== revision) throw new Error("Mission changed. Refresh and confirm removal again.");
    if (activeRun(task)) task = await this.reconcile(taskId);
    this.assertOwner(task);
    if (task.state.worktree?.mergeAttempt?.status === "attempting") throw new Error("Resolve the pending merge transaction before removing this mission.");
    if (!["ended", "cancelled"].includes(task.state.executionStatus)) {
      task = await this.act(taskId, task.state.revision, "cancel", undefined, "Mission removed from saved list", "tui");
    }
    this.store.remove(taskId, task.state.revision);
  }

  mergeApproval(taskId: string): MergeApproval {
    return this.worktrees.approval(this.worktree(this.store.load(taskId)));
  }

  private async merge(task: TaskRecord, approval: MergeApproval, source: "command" | "tui", reason: string): Promise<TaskRecord> {
    if (task.state.currentState !== "merge" || activeRun(task) || task.state.executionStatus !== "awaiting-user") throw new Error("Merge requires accepted tests and an explicit final confirmation.");
    const worktree = this.worktree(task);
    task = this.store.update(task.state.taskId, task.state.revision, state => {
      state.worktree!.mergeAttempt = { ...approval, status: "attempting" };
    });
    try {
      const mergeCommit = await this.worktrees.merge(worktree, approval);
      task = this.store.update(task.state.taskId, task.state.revision, state => {
        state.worktree!.mergeCommit = mergeCommit;
        state.worktree!.mergeAttempt = { ...approval, status: "merged" };
      });
    } catch (error) {
      this.store.update(task.state.taskId, task.state.revision, state => {
        state.worktree!.mergeAttempt = { ...approval, status: "failed", error: String(error) };
      });
      throw error;
    }
    return this.store.transition(task.state.taskId, task.state.revision, "merge", "end", reason, source, this.sessionId);
  }

  async act(taskId: string, revision: number, action: Action, target: Stage | undefined, reason: string, source: "command" | "tui", approval?: MergeApproval): Promise<TaskRecord> {
    let task = this.store.load(taskId);
    if (task.state.revision !== revision) throw new Error("Mission changed. Refresh status and repeat the order.");
    this.assertOwner(task);
    if (!["pause", "cancel", "end"].includes(action)) this.assertIdle(taskId);
    if (action === "end" && !["implementation", "review", "tests", "merge"].includes(task.state.currentState)) throw new Error("End without merging is available from implementation onward.");
    if (action === "back" && (!target || STAGES.indexOf(target) >= STAGES.indexOf(task.state.currentState) || !task.state.history.some(entry => entry.to === target))) throw new Error("Back requires an earlier visited stage.");
    if (activeRun(task)) {
      if (!["back", "end", "pause", "cancel"].includes(action)) throw new Error("Stage still active. Wait, or order pause first.");
      this.services.cancelInterview?.(task, activeRun(task)!);
      await this.runner.stop(receiptOf(activeRun(task)!));
      task = await this.reconcile(taskId);
    }
    if (action === "merge") {
      if (!approval) throw new Error("Explicit merge confirmation is missing.");
      return this.merge(task, approval, source, reason);
    }
    const head = action === "next" ? this.worktrees.candidateHead(this.worktree(task)) : undefined;
    if (head && task.state.stageRuns.filter(run => run.stage === task.state.currentState && !run.stale).at(-1)?.candidateHead !== head) throw new Error("Candidate changed after these findings. Retry the stage before approving it.");
    return this.store.transition(taskId, task.state.revision, action, target, reason, source, this.sessionId, head);
  }
}
