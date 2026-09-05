// Single-owner state machine: persisted intents precede asynchronous effects; completions refill the DAG.
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  compileImplementationPlan, compileResearchBrief, compileRecord, reviewResultSchema, writerResultSchema,
  type ReviewResult, type WriterResult, type ImplementationPlan, validateImplementationPlan,
} from "../complex-work-contracts.ts";
import { atomicJson, readJson, containedPath, type CheckEvidence } from "./io.ts";
import { durableCheck } from "./checks.ts";
import * as repository from "./git.ts";
import { ROLE_NAMES } from "./roles.ts";
import { inspectRun, RpcError, type Rpc, type Receipt } from "./rpc.ts";
import { prompt, taskRecord } from "./prompts.ts";
import {
  approved, approvalDigest, canStartTask, event, freshTask, isAgent, orderedTasks,
  RESEARCH_ANGLES, REVIEW_ANGLES, terminal, validatePolicy,
  type Job, type JobKind, type Mission, type Policy, type TaskState,
} from "./state.ts";

export type EnginePorts = {
  rpc: Rpc; save: (state: Mission) => Promise<void>; notice: (message: string, attention: boolean) => void;
  local?: (state: Mission, job: Job, signal: AbortSignal) => Promise<any>;
  diff?: (state: Mission, job: Job) => Promise<string>;
};
export class ComplexWorkEngine {
  state: Mission;
  private ports: EnginePorts;
  private queue: Promise<unknown> = Promise.resolve();
  private controllers = new Map<string, AbortController>();
  private disposed = false;
  constructor(state: Mission, ports: EnginePorts) { this.state = state; this.ports = ports; }

  /** Commands and completion handlers share one queue; effects run outside it. */
  async transaction<T>(action: () => Promise<T> | T): Promise<T> {
    const next = this.queue.then(async () => {
      if (this.disposed) throw new Error("This mission controller is no longer active");
      const value = await action();
      await this.ports.save(this.state);
      this.pump();
      return value;
    });
    this.queue = next.catch(error => this.ports.notice(String(error), true));
    return next;
  }
  async start(): Promise<void> { await this.transaction(() => event(this.state, "Mission started")); }
  dispose(): void { this.disposed = true; }
  private active(kind: JobKind, taskId?: string, angle?: string): boolean {
    return Object.values(this.state.jobs).some(job => job.kind === kind && job.taskId === taskId && job.angle === angle);
  }
  private capacity(kind: JobKind): boolean {
    const jobs = Object.values(this.state.jobs);
    if (isAgent(kind)) return jobs.filter(job => isAgent(job.kind)).length < this.state.policy.maxAgents;
    if (["validate", "final-check", "integrate"].includes(kind)) {
      const available = jobs.filter(job => ["validate", "final-check", "integrate"].includes(job.kind)).length < this.state.policy.maxChecks;
      return available && (kind !== "integrate" || !jobs.some(job => job.kind === "integrate"));
    }
    return !jobs.some(job => job.kind === kind);
  }
  private schedule(kind: JobKind, taskId?: string, angle?: string): boolean {
    if (this.active(kind, taskId, angle) || !this.capacity(kind)) return false;
    if (isAgent(kind) && this.state.launches >= this.state.policy.maxLaunches) {
      this.state.paused = true; event(this.state, "Agent launch budget exhausted; change policy before resuming");
      this.ports.notice("Agent launch budget exhausted. Work is paused with artifacts preserved.", true);
      return false;
    }
    const id = randomUUID();
    const lane = taskId ? this.state.tasks[taskId] : undefined;
    const job: Job = {
      id, kind, taskId, angle, revision: this.state.revision, status: "launching",
      cwd: lane?.cwd ?? this.state.workspace.repo,
      receipt: path.join(this.state.workspace.root, "receipts", `${id}.json`), createdAt: new Date().toISOString(),
    };
    this.state.jobs[id] = job;
    if (isAgent(kind)) this.state.launches++;
    event(this.state, `Queued ${kind}${taskId ? ` for ${taskId}` : ""}${angle ? ` (${angle})` : ""}`);
    // Save the reservation before RPC so concurrent controls cannot admit a duplicate.
    void this.transaction(async () => {}).then(() => this.effect(job)).catch(() => {});
    return true;
  }
  private pump(): void {
    const s = this.state;
    if (this.disposed || s.paused || terminal(s)) return;
    if (s.phase === "researching") {
      for (const angle of RESEARCH_ANGLES) if (!s.reports[angle]) this.schedule("scout", undefined, angle);
      return;
    }
    if (s.phase === "synthesizing") { this.schedule("synthesis"); return; }
    if (s.phase === "planning") { this.schedule("planner"); return; }
    if (s.phase === "final-checks") { this.schedule("final-check"); return; }
    if (s.phase === "final-review") {
      for (const angle of REVIEW_ANGLES) if (!s.finalReviews[angle]) this.schedule("reviewer", undefined, angle);
      return;
    }
    if (s.phase !== "running" || !s.plan || !approved(s)) return;
    for (const task of orderedTasks(s.plan)) {
      const lane = s.tasks[task.id];
      if (canStartTask(s, task) && this.schedule("prepare", task.id)) lane.stage = "preparing";
      if (lane.stage === "scouting") this.schedule("scout", task.id);
      if (lane.stage === "scouted" && this.schedule("writer", task.id)) lane.stage = "writing";
      if (lane.stage === "written" && this.schedule("validate", task.id)) lane.stage = "checking";
      if (lane.stage === "reviewing") {
        for (const angle of REVIEW_ANGLES) if (!lane.reviews[angle]) this.schedule("reviewer", task.id, angle);
      }
      if (lane.stage === "ready" && (s.policy.checkpoints === "final" || lane.checkpointApproved)
        && this.schedule("integrate", task.id)) lane.stage = "integrating";
    }
    if (s.plan.tasks.every(task => s.tasks[task.id].stage === "done") && !Object.keys(s.jobs).length) {
      s.phase = "final-checks";
      event(s, "All tasks integrated; checking the complete result");
      this.schedule("final-check");
    }
  }
  private async effect(job: Job): Promise<void> {
    if (this.disposed || !this.state.jobs[job.id]) return;
    if (terminal(this.state)) { await this.fail(job.id, "Cancelled before dispatch"); return; }
    const signal = new AbortController();
    this.controllers.set(job.id, signal);
    const snapshot = structuredClone(this.state);
    try {
      if (isAgent(job.kind)) {
        const task = snapshot.plan?.tasks.find(task => task.id === job.taskId);
        const lane = job.taskId ? snapshot.tasks[job.taskId] : undefined;
        const diff = job.kind === "reviewer" ? await (this.ports.diff
          ? this.ports.diff(snapshot, job)
          : repository.patch(job.cwd, lane?.base ?? snapshot.workspace.baseline, lane?.candidate ?? snapshot.workspace.head)) : "";
        const params = {
          agent: ROLE_NAMES[job.kind], task: prompt(snapshot, job, diff), async: true, context: "fresh", mission: false,
          cwd: job.cwd, output: false, worktree: false, timeoutMs: snapshot.policy.runTimeoutMs,
          ...(job.kind === "writer" && task?.model ? { model: task.model } : {}),
          extensionBindings: { "complex-work/2": { operationId: job.id, role: job.kind, cwd: job.cwd, receipt: job.receipt, resources: task?.resources ?? [], checks: task?.checks ?? [] } },
        };
        const data = await this.ports.rpc("spawn", params);
        const runId = data.details?.runId ?? data.details?.asyncId;
        if (!runId) throw new RpcError("Spawn returned no run id", true);
        await this.transaction(() => {
          const current = this.state.jobs[job.id];
          if (!current) return;
          current.runId = runId; current.asyncDir = data.details?.asyncDir; current.status = "running";
        });
        if (terminal(this.state)) await this.ports.rpc("stop", { id: runId });
      } else {
        const value = await (this.ports.local ?? runLocal)(snapshot, job, signal.signal);
        await atomicJson(job.receipt, { operationId: job.id, value });
        await this.complete(job.id, value);
      }
    } catch (error) {
      if (this.disposed) return;
      if (error instanceof RpcError && error.uncertain) {
        await this.transaction(() => {
          const current = this.state.jobs[job.id];
          if (!current) return;
          current.status = "uncertain"; current.error = String(error);
          this.ports.notice(`The ${job.kind} launch is uncertain. Its slot remains reserved while status is reconciled.`, true);
        });
      } else await this.fail(job.id, String(error));
    } finally { this.controllers.delete(job.id); }
  }
  /** Early and duplicate completions are correlated through the durable receipt or run id. */
  async onCompletion(payload: any): Promise<void> {
    let job = Object.values(this.state.jobs).find(job => job.runId === payload?.runId);
    if (!job) {
      for (const candidate of Object.values(this.state.jobs).filter(job => isAgent(job.kind))) {
        const receipt = await readJson<Receipt>(candidate.receipt);
        if (receipt?.operationId === candidate.id && receipt.runId === payload?.runId) { job = candidate; break; }
      }
    }
    if (!job) return;
    if (payload.success !== true || ["failed", "stopped", "rejected", "paused"].includes(payload.state)) { await this.fail(job.id, payload.error ?? `${job.kind} did not complete`); return; }
    const receipt = await readJson<Receipt>(job.receipt);
    const output = receipt?.output ?? payload.results?.[0]?.output ?? payload.output ?? "";
    await this.complete(job.id, output);
  }
  async reconcile(): Promise<void> {
    for (const job of Object.values(this.state.jobs)) {
      if (!isAgent(job.kind)) {
        const result = await readJson<{ operationId: string; value: unknown }>(job.receipt);
        if (result?.operationId === job.id) await this.complete(job.id, result.value);
        else if (!this.controllers.has(job.id) && !terminal(this.state)) void this.effect(job);
        else if (!this.controllers.has(job.id) && terminal(this.state)) await this.fail(job.id, "Cancelled before recovery");
        continue;
      }
      try {
        const status = await inspectRun(job, this.ports.rpc);
        if (status.runId && !job.runId) await this.transaction(() => { if (this.state.jobs[job.id]) this.state.jobs[job.id].runId = status.runId; });
        if (terminal(this.state) && ["running", "queued"].includes(status.state) && status.runId) await this.ports.rpc("stop", { id: status.runId });
        if (status.state === "complete") await this.complete(job.id, status.output ?? "");
        else if (["failed", "stopped", "rejected", "paused"].includes(status.state)) await this.fail(job.id, `${job.kind}: ${status.state}`);
      } catch (error) { this.ports.notice(`Could not reconcile ${job.kind}: ${String(error)}`, false); }
    }
  }
  private async complete(id: string, value: any): Promise<void> {
    await this.transaction(async () => {
      const job = this.state.jobs[id];
      if (!job) return;
      delete this.state.jobs[id];
      if (terminal(this.state) || job.revision !== this.state.revision) return;
      try { await this.accept(job, value); }
      catch (error) { this.failure(job, String(error)); }
    });
  }
  private async fail(id: string, message: string): Promise<void> {
    await this.transaction(() => {
      const job = this.state.jobs[id];
      if (!job) return;
      delete this.state.jobs[id];
      if (!terminal(this.state)) this.failure(job, message);
    });
  }
  private failure(job: Job, message: string): void {
    event(this.state, `${job.kind} failed: ${message}`);
    if (job.taskId) {
      const lane = this.state.tasks[job.taskId];
      lane.error = message;
      const key = `${job.kind}:${job.angle ?? ""}`;
      lane.attempts[key] = (lane.attempts[key] ?? 0) + 1;
      if (["writer", "validate"].includes(job.kind) && lane.repairs < this.state.policy.maxRepairs) {
        this.repair(job.taskId, message); return;
      }
      if (isAgent(job.kind) && lane.attempts[key] < this.state.policy.maxAttempts) {
        if (job.kind === "writer") lane.stage = "scouted";
        return;
      }
      lane.stage = "blocked";
      this.ports.notice(`${job.taskId} is blocked: ${message}. Independent tasks can continue.`, true);
      return;
    }
    const key = `${job.kind}:${job.angle ?? ""}`;
    const count = (this.state.discoveryAttempts[key] ?? 0) + 1;
    this.state.discoveryAttempts[key] = count;
    this.state.errors = [message];
    if (!isAgent(job.kind) || count >= this.state.policy.maxAttempts) {
      this.state.phase = "blocked";
      this.ports.notice(`Complex work needs attention: ${message}`, true);
    }
  }
  private repair(taskId: string, message: string): void {
    const lane = this.state.tasks[taskId];
    if (lane.repairs >= this.state.policy.maxRepairs) {
      lane.stage = "blocked"; lane.error = message;
      this.ports.notice(`${taskId} exhausted its repair budget. Artifacts are preserved.`, true); return;
    }
    lane.repairs++; lane.stage = "scouted"; lane.error = message;
    lane.reviews = {}; lane.checks = undefined; lane.checkpointApproved = false;
    event(this.state, `Automatic correction ${lane.repairs} for ${taskId}`);
  }
  private async accept(job: Job, value: any): Promise<void> {
    const s = this.state;
    const lane = job.taskId ? s.tasks[job.taskId] : undefined;
    event(s, `Completed ${job.kind}${job.taskId ? ` for ${job.taskId}` : ""}`);
    if (job.kind === "scout") {
      if (!String(value).trim()) throw new Error("Scout returned no evidence");
      if (lane) { lane.scout = value; lane.stage = "scouted"; }
      else { s.reports[job.angle!] = value; if (RESEARCH_ANGLES.every(angle => s.reports[angle])) s.phase = "synthesizing"; }
      return;
    }
    if (job.kind === "synthesis") {
      s.draft = value;
      const result = compileResearchBrief(value);
      if (!result.ok) throw new Error(result.errors.join("\n"));
      s.brief = result.value; s.draft = undefined; s.errors = [];
      s.phase = s.brief.unresolvedDecisions.length ? "research-decision" : "planning";
      if (s.phase === "research-decision") this.ports.notice(`Research needs your decisions: ${JSON.stringify(s.brief.unresolvedDecisions)}`, true);
      return;
    }
    if (job.kind === "planner") {
      s.draft = value;
      const result = compileImplementationPlan(value);
      if (!result.ok) throw new Error(result.errors.join("\n"));
      this.acceptPlan(result.value); return;
    }
    if (job.kind === "prepare") { lane!.cwd = value.cwd; lane!.base = value.base; lane!.stage = "scouting"; return; }
    if (job.kind === "writer") {
      const result = compileRecord<WriterResult>(value, writerResultSchema);
      if (!result.ok) throw new Error(result.errors.join("\n"));
      lane!.handoff = value;
      if (result.value.status === "blocked" || result.value.blockers.length) {
        const message = result.value.blockers.map(blocker => blocker.message).join("\n") || result.value.summary;
        if (result.value.blockers.some(blocker => blocker.kind === "decision")) {
          lane!.stage = "blocked"; lane!.decision = true; lane!.error = message;
          this.ports.notice(`${job.taskId} needs a decision: ${message}`, true);
        } else this.repair(job.taskId!, message);
        return;
      }
      const task = s.plan!.tasks.find(task => task.id === job.taskId)!;
      if (task.criteria.some(id => !result.value.criteria.includes(id))) throw new Error("Writer did not address every assigned criterion");
      lane!.stage = "written"; return;
    }
    if (job.kind === "validate") {
      lane!.checks = value.checks; lane!.candidate = value.candidate; lane!.version++;
      lane!.reviews = {}; lane!.stage = "reviewing"; return;
    }
    if (job.kind === "reviewer") { this.acceptReview(job, value); return; }
    if (job.kind === "integrate") {
      s.workspace.head = value.head; lane!.stage = "done"; lane!.completedAt = new Date().toISOString();
      return;
    }
    if (job.kind === "final-check") { s.finalChecks = value.checks; s.finalReviews = {}; s.phase = "final-review"; return; }
    if (job.kind === "deliver") { s.phase = "completed"; this.ports.notice("Complex work completed. The reviewed patch is applied; your index and branch are unchanged.", true); }
  }
  private acceptReview(job: Job, output: string): void {
    const result = compileRecord<ReviewResult>(output, reviewResultSchema);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    const report = result.value;
    const s = this.state;
    const task = s.plan!.tasks.find(task => task.id === job.taskId);
    const criteria = task?.criteria ?? s.plan!.acceptanceCriteria.map(item => item.id);
    if (criteria.some(id => !report.coveredCriteria.includes(id))) throw new Error("Review omitted required acceptance criteria");
    if (report.verdict === "pass" && report.findings.some(finding => finding.severity !== "P2")) throw new Error("Passing review contains blocking findings");
    if (report.verdict !== "pass" && !report.findings.length) throw new Error("Blocking review requires concrete findings");
    const lane = job.taskId ? s.tasks[job.taskId] : undefined;
    const reviews = lane?.reviews ?? s.finalReviews;
    reviews[job.angle!] = report;
    if (!REVIEW_ANGLES.every(angle => reviews[angle])) return;
    const findings = JSON.stringify(reviews);
    const decision = Object.values(reviews).some(review => review.verdict === "decision");
    const fix = Object.values(reviews).some(review => review.verdict === "fix");
    if (!lane) {
      if (fix && !decision && this.repairFinal(reviews)) return;
      s.phase = decision || fix ? "blocked" : "awaiting-delivery";
      if (decision || fix) s.errors = [findings];
      this.ports.notice(decision || fix ? `Final review needs correction: ${findings}` : `All checks and reviews passed. Inspect ${s.workspace.repo}; /complex-work-verify ${s.revision} applies the reviewed result.`, true);
      return;
    }
    if (decision) { lane.stage = "blocked"; lane.decision = true; lane.error = findings; this.ports.notice(`${job.taskId} needs a decision: ${findings}`, true); }
    else if (fix) this.repair(job.taskId!, findings);
    else {
      lane.stage = "ready";
      if (s.policy.checkpoints === "task") this.ports.notice(`${job.taskId} passed review. /complex-work-approve-task ${job.taskId} integrates it.`, true);
    }
  }
  private repairFinal(reviews: Record<string, ReviewResult>): boolean {
    const s = this.state;
    const findings = Object.values(reviews).filter(review => review.verdict === "fix").flatMap(review => review.findings);
    if (findings.some(finding => !finding.taskId || !s.tasks[finding.taskId])) return false;
    const targets = new Set(findings.map(finding => finding.taskId!));
    if ([...targets].some(id => s.tasks[id].repairs >= s.policy.maxRepairs)) return false;
    const affected = new Set(targets);
    let added = true;
    while (added) {
      added = false;
      for (const task of s.plan!.tasks) {
        if (!affected.has(task.id) && task.dependsOn.some(id => affected.has(id))) { affected.add(task.id); added = true; }
      }
    }
    for (const id of affected) {
      const previous = s.tasks[id];
      s.tasks[id] = { ...freshTask(), repairs: previous.repairs + (targets.has(id) ? 1 : 0), version: previous.version,
        error: targets.has(id) ? JSON.stringify(findings.filter(finding => finding.taskId === id)) : "Revalidate after a dependency correction" };
    }
    s.phase = "running"; s.finalChecks = undefined; s.finalReviews = {};
    event(s, `Final review corrections routed to ${[...targets].join(", ")}; dependent evidence invalidated`);
    return true;
  }
  private acceptPlan(plan: ImplementationPlan): void {
    const s = this.state;
    s.plan = plan; s.revision++; s.approval = undefined; s.tasks = Object.fromEntries(plan.tasks.map(task => [task.id, freshTask()]));
    s.phase = "awaiting-approval"; s.draft = undefined; s.errors = []; s.finalChecks = undefined; s.finalReviews = {};
    event(s, `Plan revision ${s.revision} awaits approval`);
    this.ports.notice(`Plan revision ${s.revision}:\n${JSON.stringify(plan, null, 2)}\nPolicy: ${JSON.stringify(s.policy)}\nApprove with /complex-work-go ${s.revision}.`, true);
  }
  /** Only the command adapter calls userAction; the model-facing tool cannot authorize effects. */
  async userAction(action: string, argument = ""): Promise<void> {
    await this.transaction(async () => {
      const s = this.state;
      if (terminal(s)) throw new Error(`Mission is ${s.phase}`);
      if (action === "pause") { s.paused = true; event(s, "User paused scheduling; running work can finish"); return; }
      if (action === "resume") { if (Object.values(s.jobs).some(job => job.status === "uncertain")) throw new Error("Reconcile uncertain operations before resuming"); s.paused = false; event(s, "User resumed scheduling"); return; }
      if (action === "policy") {
        if (Object.keys(s.jobs).length || (s.approval && !s.paused)) throw new Error("Pause and let active work finish before changing policy");
        s.policy = validatePolicy({ ...s.policy, ...JSON.parse(argument) });
        if (s.approval) s.approval.digest = approvalDigest(s);
        event(s, "User updated operating policy"); return;
      }
      if (action === "go") {
        if (s.phase !== "awaiting-approval" || Number(argument) !== s.revision) throw new Error(`Approve the displayed plan revision: /complex-work-go ${s.revision}`);
        s.approval = { revision: s.revision, digest: approvalDigest(s), at: new Date().toISOString() };
        s.phase = "running"; s.paused = false; event(s, `User approved revision ${s.revision}`); return;
      }
      if (action === "decide") {
        if (s.phase !== "research-decision" || !s.brief) throw new Error("No research decisions are pending");
        const answers = JSON.parse(argument);
        if (!Array.isArray(answers) || answers.length !== s.brief.unresolvedDecisions.length || answers.some(value => typeof value !== "string" || !value.trim())) throw new Error("Provide a JSON array with one answer per displayed decision, in order");
        s.brief.resolvedDecisions = [...(s.brief.resolvedDecisions ?? []), ...s.brief.unresolvedDecisions.map((question, index) => `${question}: ${answers[index]}`)];
        s.brief.unresolvedDecisions = []; s.phase = "planning"; s.errors = []; event(s, "User resolved research decisions"); return;
      }
      if (action === "approve-task") {
        const lane = s.tasks[argument];
        if (lane?.stage !== "ready") throw new Error("Task is not ready for integration");
        lane.checkpointApproved = true; event(s, `User approved integration of ${argument}`); return;
      }
      if (action === "verify") {
        if (s.phase !== "awaiting-delivery" || Number(argument) !== s.revision || Object.keys(s.jobs).length) throw new Error("Delivery requires the current reviewed revision and no active jobs");
        if (!approved(s)) throw new Error("Plan approval is stale");
        event(s, `User approved delivery of revision ${s.revision}`); this.schedule("deliver"); return;
      }
      if (action === "retry") { this.retry(argument); return; }
      if (action === "replan") {
        if (Object.keys(s.jobs).length) throw new Error("Pause and let running jobs finish before replanning");
        if (!s.brief) throw new Error("Research must finish before replanning");
        s.errors = [...s.errors, ...(argument ? [argument] : [])]; s.phase = "planning"; s.approval = undefined; s.draft = undefined; s.paused = false;
        s.discoveryAttempts = {}; event(s, "User requested a replacement plan; completed IDs will not be reused as completion evidence"); return;
      }
      throw new Error(`Unknown action: ${action}`);
    });
  }
  private retry(taskId: string): void {
    const s = this.state;
    if (taskId) {
      const lane = s.tasks[taskId];
      if (lane?.stage !== "blocked" || Object.values(s.jobs).some(job => job.taskId === taskId)) throw new Error("Only an idle blocked task can be retried");
      if (lane.decision) throw new Error("This task needs a plan change; use replan with your decision");
      lane.attempts = {}; lane.repairs = 0; lane.reviews = {};
      lane.stage = lane.cwd ? "scouted" : "pending";
    } else {
      if (s.phase !== "blocked" || Object.keys(s.jobs).length) throw new Error("No idle failed discovery/final gate to retry");
      s.discoveryAttempts = {}; s.draft = undefined;
      s.phase = s.plan && Object.values(s.tasks).every(task => task.stage === "done") ? "final-checks" : s.brief ? "planning" : RESEARCH_ANGLES.every(angle => s.reports[angle]) ? "synthesizing" : "researching";
    }
    event(s, `User renewed retry budget${taskId ? ` for ${taskId}` : ""}`);
  }
  async steer(message: string): Promise<void> {
    if (!message.trim()) throw new Error("Provide steering guidance");
    await this.transaction(() => { this.state.steering.push(message); event(this.state, "User guidance recorded; scope and approval remain unchanged"); });
    for (const job of Object.values(this.state.jobs).filter(job => isAgent(job.kind) && job.runId)) {
      try { const result = await this.ports.rpc("steer", { id: job.runId!, message, mode: "follow_up" }); this.ports.notice(`${job.kind}${job.taskId ? ` ${job.taskId}` : ""}: ${JSON.stringify(result)}`, false); }
      catch (error) { this.ports.notice(`Guidance retained for future work; delivery to ${job.kind} failed: ${String(error)}`, false); }
    }
  }
  async cancel(): Promise<void> {
    await this.transaction(() => { this.state.phase = "cancelled"; this.state.paused = true; event(this.state, "User cancelled; stopping active work and retaining artifacts"); });
    for (const controller of this.controllers.values()) controller.abort();
    for (const job of Object.values(this.state.jobs)) {
      const receipt = await readJson<Receipt>(job.receipt);
      const id = job.runId ?? receipt?.runId;
      if (!id || !isAgent(job.kind)) continue;
      try { await this.ports.rpc("stop", { id }); }
      catch (error) { this.ports.notice(`Cancellation of ${id} needs reconciliation: ${String(error)}`, true); }
    }
  }
}

/** Local mechanics never rely on an agent's claim that checks passed or patches were applied. */
export async function runLocal(state: Mission, job: Job, signal: AbortSignal): Promise<any> {
  const task = state.plan?.tasks.find(task => task.id === job.taskId);
  const lane = job.taskId ? state.tasks[job.taskId] : undefined;
  if (job.kind === "prepare") return { cwd: await repository.createCheckout(state.workspace, job.id, state.workspace.head), base: state.workspace.head };
  if (job.kind === "validate") {
    const before = await repository.checkpoint(job.cwd, `Candidate ${job.taskId}`);
    await repository.assertScope(job.cwd, lane!.base!, before, task!.resources, taskRecord(state, task!.id));
    const checks = await checkAll(task!.checks, job.cwd, signal, job.receipt);
    const record = taskRecord(state, task!.id);
    const recordPath = await containedPath(job.cwd, record);
    await mkdir(path.dirname(recordPath), { recursive: true });
    await writeFile(recordPath, `# ${task!.objective}\n\n## Description\n\n${task!.objective}\n\n## Research summary\n\n${lane!.scout}\n\n## Status\n\nImplemented; awaiting independent review and integration.\n\n## Acceptance criteria\n\n${task!.criteria.join("\n")}\n\n## Validation\n\n${checks.map(check => `${check.check.id}: exit ${check.code}`).join("\n")}\n`);
    const candidate = await repository.checkpoint(job.cwd, `Checked ${job.taskId}`);
    await repository.assertScope(job.cwd, lane!.base!, candidate, task!.resources, record);
    return { candidate, checks };
  }
  if (job.kind === "integrate") {
    const cwd = await repository.integrationCandidate(state.workspace, job.id, { cwd: lane!.cwd!, base: lane!.base!, candidate: lane!.candidate! });
    const record = taskRecord(state, task!.id);
    await writeFile(await containedPath(cwd, record), `# ${task!.objective}\n\n## Description\n\n${task!.objective}\n\n## Research summary\n\n${lane!.scout}\n\n## Status\n\nfinished\n\n## Acceptance criteria\n\n${task!.criteria.join("\n")}\n\n## Validation\n\n${lane!.checks!.map(check => `${check.check.id}: exit ${check.code}`).join("\n")}\n\n## Review\n\nRevision ${lane!.candidate}; all three independent review angles passed.\n`);
    const before = await repository.checkpoint(cwd, `Integration candidate ${task!.id}`);
    const checks = await checkAll(task!.checks, cwd, signal, job.receipt);
    const head = await repository.checkpoint(cwd, `Integrated ${task!.id}`);
    if ((await repository.changedFiles(cwd, before, head)).length) throw new Error("Integration checks modified reviewed source; correction and fresh review are required");
    await repository.assertScope(cwd, state.workspace.head, head, task!.resources, taskRecord(state, task!.id));
    if (signal.aborted) throw new Error("Integration cancelled");
    await repository.adopt(state.workspace, cwd, head);
    return { head, checks };
  }
  if (job.kind === "final-check") {
    const cwd = await repository.createCheckout(state.workspace, job.id, state.workspace.head);
    const checks = await checkAll(state.plan!.finalChecks, cwd, signal, job.receipt);
    const after = await repository.checkpoint(cwd, "Final verification snapshot");
    if ((await repository.changedFiles(cwd, state.workspace.head, after)).length) throw new Error("Final checks changed source; review and validate the change through a new task");
    return { checks };
  }
  if (job.kind === "deliver") { await repository.deliver(state.workspace, signal); return {}; }
  throw new Error(`Unsupported local operation ${job.kind}`);
}
async function checkAll(checks: ImplementationPlan["finalChecks"], cwd: string, signal: AbortSignal, evidenceRoot: string): Promise<CheckEvidence[]> {
  const evidence: CheckEvidence[] = [];
  for (const check of checks) {
    const result = await durableCheck(check, cwd, `${evidenceRoot}.checks`, signal);
    evidence.push(result);
    if (result.code !== 0 || result.timedOut || result.cancelled) throw new Error(`Check ${check.id} failed (exit ${result.code}): ${result.stderr}\n${result.stdout}`);
  }
  return evidence;
}
