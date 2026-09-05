// Durable work ledger and bounded execution. Only model-authored dependencies choose the sequence.
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  compileImplementationPlan, compileResearchBrief, compileRecord, deliverySchema, validateWorkBatch,
  resourcesConflict, type Assignment, type DeliveryEvidence, type WorkDefinition,
} from "../complex-work-contracts.ts";
import { atomicJson, readJson } from "./io.ts";
import { inspectRun, RpcError, type Rpc, type Receipt } from "./rpc.ts";
import { active, approved, approvalDigest, event, isAgent, terminal, validatePolicy, writable, type Job, type Mission, type WorkResult } from "./state.ts";
import { captureInput, prepareAgent, collectAgentResult, resultError, runLocal } from "./execution.ts";
import { assertDelivery, assertIntegration } from "./evidence.ts";
import { prompt } from "./prompts.ts";
import * as repository from "./git.ts";

export { runLocal } from "./execution.ts";
export type EnginePorts = {
  rpc: Rpc; save: (state: Mission) => Promise<void>; notice: (message: string, attention: boolean) => void;
  register: (job: Job, assignment: Assignment) => string;
  prepare?: typeof prepareAgent; collect?: typeof collectAgentResult; local?: typeof runLocal;
  prompt?: typeof prompt;
  deliver?: (state: Mission, signal: AbortSignal) => Promise<void>;
};
export class ComplexWorkEngine {
  state: Mission;
  private ports: EnginePorts;
  private queue: Promise<unknown> = Promise.resolve();
  private controllers = new Map<string, AbortController>();
  private completing = new Set<string>();
  private disposed = false;
  private delivering = false;
  constructor(state: Mission, ports: EnginePorts) { this.state = state; this.ports = ports; }
  async transaction<T>(action: () => Promise<T> | T): Promise<T> {
    const next = this.queue.then(async () => {
      if (this.disposed) throw new Error("Mission controller is no longer active");
      const value = await action();
      await this.ports.save(this.state);
      this.pump();
      return value;
    });
    this.queue = next.catch(error => this.ports.notice(String(error), true));
    return next;
  }
  dispose(): void { this.disposed = true; }
  async start(): Promise<void> {
    await this.transaction(() => event(this.state, "Mission started; no work is prescribed"));
    this.wake("Inspect the request and private snapshot. Choose what to investigate or propose scope when ready.");
  }
  private wake(message: string): void {
    this.ports.notice(`${message}\nRequest: ${this.state.request}\nPrivate repository: ${this.state.workspace.repo}\nUse complex_work_control for the ledger and evidence. Choose the next work through complex_work_submit, or propose scope through complex_work_scope. Completion does not imply another agent or stage. Do not ask the user to operate routine assignments.`, true);
  }
  private available(): void {
    if (terminal(this.state) || this.state.legacy) throw new Error("Mission is terminal or uses a legacy workflow");
    if (this.state.delivery) throw new Error("Delivery is reserved; withdraw it before scheduling or changing scope");
  }
  /** Scope defines authority, not agent identities or an executable pipeline. */
  async submitScope(brief: unknown, plan: unknown): Promise<void> {
    const b = compileResearchBrief(JSON.stringify(brief)); const p = compileImplementationPlan(JSON.stringify(plan));
    if (!b.ok) throw new Error(b.errors.join("\n"));
    if (!p.ok) throw new Error(p.errors.join("\n"));
    await this.transaction(() => {
      this.available();
      if (this.state.decisions.length) throw new Error("Resolve pending user decisions before replacing scope");
      if (Object.values(this.state.work).some(active)) throw new Error("Pause and drain active work before replacing scope");
      if (b.value.unresolvedDecisions.length) {
        this.state.decisions = b.value.unresolvedDecisions;
        this.wake(`User decisions needed: ${JSON.stringify(this.state.decisions)}`); return;
      }
      for (const work of Object.values(this.state.work)) if (work.status === "pending") {
        work.status = "cancelled"; work.error = "Superseded by a scope proposal";
      }
      this.state.brief = b.value; this.state.plan = p.value; this.state.revision++;
      this.state.approval = undefined; this.state.integrations = {}; this.state.decisions = [];
      event(this.state, `Scope revision ${this.state.revision} proposed`);
      this.ports.notice(`Scope revision ${this.state.revision}:\n${JSON.stringify(p.value, null, 2)}\nPolicy: ${JSON.stringify(this.state.policy)}\nApprove with /complex-work-go ${this.state.revision}.`, true);
    });
  }
  async submitWork(value: unknown): Promise<void> {
    await this.transaction(() => {
      this.available();
      if (this.state.decisions.length) throw new Error("Resolve pending user decisions before adding work");
      const result = validateWorkBatch(value, Object.values(this.state.work).map(job => job));
      if (!result.ok) throw new Error(result.errors.join("\n"));
      if (Object.keys(this.state.work).length + result.value.length > this.state.policy.maxWorkItems) throw new Error("Work item budget exhausted");
      for (const item of result.value) {
        if (item.taskId && !this.state.plan?.tasks.some(task => task.id === item.taskId)) throw new Error(`Unknown scope task: ${item.taskId}`);
        if ((item.kind !== "agent" || item.access === "write") && !this.state.plan) throw new Error("Propose scope before adding protected operations");
      }
      for (const item of result.value) {
        const operationId = randomUUID();
        this.state.work[item.id] = { ...item, operationId, revision: this.state.revision, status: "pending",
          receipt: path.join(this.state.workspace.root, "receipts", `${operationId}.json`), createdAt: new Date().toISOString() };
        event(this.state, `Queued ${item.id}: ${"assignment" in item ? item.assignment.name : item.kind}`);
      }
    });
  }
  private ready(job: Job): boolean {
    return job.status === "pending" && job.dependsOn.every(id => this.state.work[id]?.status === "completed"
      || (job.allowFailed?.includes(id) && this.state.work[id]?.status === "failed"));
  }
  private capacity(job: Job): boolean {
    const running = Object.values(this.state.work).filter(active);
    if (isAgent(job) && running.filter(isAgent).length >= this.state.policy.maxAgents) return false;
    if (!isAgent(job) && running.filter(other => !isAgent(other)).length >= this.state.policy.maxChecks) return false;
    if (job.kind === "integrate" && running.some(other => other.kind === "integrate")) return false;
    if (!writable(job)) return true;
    const resources = this.state.plan!.tasks.find(task => task.id === job.taskId)!.resources;
    return !running.filter(writable).some(other => this.state.plan!.tasks.find(task => task.id === other.taskId)!.resources.some(a => resources.some(b => resourcesConflict(a, b))));
  }
  private pump(): void {
    const s = this.state;
    if (this.disposed || terminal(s) || s.paused || s.legacy || s.decisions.length || s.delivery) return;
    for (const job of Object.values(s.work)) {
      if (!this.ready(job) || !this.capacity(job)) continue;
      if ((job.kind !== "agent" || job.access === "write") && (!approved(s) || job.revision !== s.revision)) continue;
      if (job.kind === "integrate" && s.policy.checkpoints === "task" && !job.integrationApproved) continue;
      if (isAgent(job) && s.launches >= s.policy.maxLaunches) {
        s.paused = true;
        void this.transaction(() => event(s, "Agent launch budget exhausted; scheduling paused"));
        this.ports.notice("Launch budget exhausted. Adjust policy before resuming.", true); return;
      }
      job.status = "running"; if (isAgent(job)) s.launches++;
      // Persist both reservation and selected input before any launch or local effect.
      void this.transaction(() => {
        try {
          if (job.kind === "integrate") assertIntegration(s, job);
          job.snapshot = captureInput(s, job);
          event(s, `Starting ${job.id}`);
        } catch (error) { job.status = "failed"; job.error = String(error); event(s, `${job.id} failed: ${job.error}`); this.wake(`Work ${job.id} was rejected: ${job.error}`); }
      }).then(() => { if (job.status === "running") void this.effect(job); }).catch(() => {});
    }
  }
  private async effect(job: Job): Promise<void> {
    if (this.disposed || this.controllers.has(job.id) || !active(job)) return;
    if (terminal(this.state) || job.cancelRequested) { await this.finish(job.id, undefined, "Cancelled before dispatch"); return; }
    const controller = new AbortController(); this.controllers.set(job.id, controller);
    try {
      if (isAgent(job)) {
        const cwd = job.cwd ?? await (this.ports.prepare ?? prepareAgent)(this.state, job);
        await this.transaction(() => { job.cwd = cwd; });
        if (terminal(this.state) || job.cancelRequested) { await this.finish(job.id, undefined, "Cancelled before dispatch"); return; }
        const assignment = "assignment" in job ? job.assignment : undefined;
        if (!assignment) throw new Error("No model-defined assignment");
        const data = await this.ports.rpc("spawn", {
          agent: this.ports.register(job, assignment), task: await (this.ports.prompt ?? prompt)(this.state, job), async: true, context: "fresh", mission: false,
          cwd, output: false, worktree: false, timeoutMs: this.state.policy.runTimeoutMs,
          ...(assignment.model ? { model: assignment.model } : {}),
          extensionBindings: { "complex-work/3": { operationId: job.operationId, role: writable(job) ? "writer" : "read-only", cwd, receipt: job.receipt,
            resources: this.state.plan?.tasks.find(task => task.id === job.taskId)?.resources ?? [],
            checks: this.state.plan?.tasks.find(task => task.id === job.taskId)?.checks ?? [] } },
        });
        const runId = data.details?.runId ?? data.details?.asyncId;
        if (!runId) throw new RpcError("Spawn returned no run id", true);
        await this.transaction(() => { job.runId = runId; job.asyncDir = data.details?.asyncDir; });
        if (terminal(this.state) || job.cancelRequested) await this.ports.rpc("stop", { id: runId });
      } else {
        const result = await (this.ports.local ?? runLocal)(structuredClone(this.state), job, controller.signal);
        await atomicJson(job.receipt, { operationId: job.operationId, result });
        await this.finish(job.id, result, resultError(job, result));
      }
    } catch (error) {
      if (this.disposed) return;
      if (error instanceof RpcError && error.uncertain) {
        await this.transaction(() => { if (active(job)) { job.status = "uncertain"; job.error = String(error); } });
        if (job.status === "uncertain") this.wake(`${job.id} has an uncertain launch; its slot remains reserved. Do not duplicate it.`);
      } else await this.finish(job.id, undefined, String(error));
    } finally { this.controllers.delete(job.id); }
  }
  async onCompletion(payload: any): Promise<void> {
    let job = Object.values(this.state.work).find(item => active(item) && item.runId === payload?.runId);
    if (!job) for (const item of Object.values(this.state.work).filter(active)) {
      const receipt = await readJson<Receipt>(item.receipt);
      if (receipt?.operationId === item.operationId && receipt.runId === payload?.runId) { job = item; break; }
    }
    if (!job || this.completing.has(job.id)) return;
    this.completing.add(job.id);
    try {
      if (payload.success !== true || ["failed", "stopped", "rejected", "paused"].includes(payload.state)) {
        await this.finish(job.id, undefined, payload.error ?? `Agent ended: ${payload.state}`); return;
      }
      const receipt = await readJson<Receipt>(job.receipt);
      if (receipt && receipt.operationId !== job.operationId) throw new Error("Mismatched child receipt");
      const output = receipt?.output ?? payload.results?.[0]?.output ?? payload.output ?? "";
      const result = await (this.ports.collect ?? collectAgentResult)(this.state, job, output);
      await atomicJson(`${job.receipt}.result.json`, { operationId: job.operationId, result });
      await this.finish(job.id, result, resultError(job, result));
    } catch (error) { await this.finish(job.id, undefined, String(error)); }
    finally { this.completing.delete(job.id); }
  }
  private async finish(id: string, result?: WorkResult, error?: string): Promise<void> {
    await this.transaction(() => {
      const job = this.state.work[id]; if (!job || !active(job)) return;
      job.result = result; job.error = error; job.finishedAt = new Date().toISOString();
      job.status = terminal(this.state) || job.cancelRequested ? "cancelled" : error ? "failed" : "completed";
      if (job.kind === "integrate" && result?.head) {
        this.state.workspace.head = result.head;
        this.state.integrations[job.taskId] = { workId: id, head: result.head, candidate: this.state.work[job.input].result!.snapshot.candidate, revision: job.revision };
      }
      event(this.state, `${id}: ${job.status}${error ? ` — ${error}` : ""}`);
      if (!terminal(this.state)) this.wake(`Work ${id} ${job.status}. Inspect its result and decide whether more work is needed. No follow-up work was invented.`);
    });
  }
  async reconcile(): Promise<void> {
    if (this.state.legacy) { await this.reconcileLegacy(); return; }
    for (const job of Object.values(this.state.work).filter(active)) {
      if (this.completing.has(job.id)) continue;
      try {
        if (!isAgent(job)) {
          const receipt = await readJson<{ operationId: string; result: WorkResult }>(job.receipt);
          if (receipt?.operationId === job.operationId) await this.finish(job.id, receipt.result, resultError(job, receipt.result));
          else if (!this.controllers.has(job.id)) void this.effect(job);
          continue;
        }
        const saved = await readJson<{ operationId: string; result: WorkResult }>(`${job.receipt}.result.json`);
        if (saved?.operationId === job.operationId) { await this.finish(job.id, saved.result, resultError(job, saved.result)); continue; }
        const status = await inspectRun(job, this.ports.rpc);
        if (status.runId && !job.runId) await this.transaction(() => { job.runId = status.runId; });
        if ((terminal(this.state) || job.cancelRequested) && ["running", "queued"].includes(status.state) && status.runId) await this.ports.rpc("stop", { id: status.runId });
        if (status.state === "complete") await this.onCompletion({ runId: status.runId, success: true, state: "complete", output: status.output });
        else if (["failed", "stopped", "rejected", "paused"].includes(status.state)) await this.finish(job.id, undefined, `Agent ended: ${status.state}`);
        else if (!status.runId && !this.controllers.has(job.id) && job.status !== "uncertain") {
          await this.transaction(() => { job.status = "uncertain"; job.error = "Restart found no proven run identity; reservation retained"; });
          this.wake(`${job.id} needs launch reconciliation; it was not relaunched.`);
        }
      } catch (error) { this.ports.notice(`Reconciliation of ${job.id}: ${String(error)}`, false); }
    }
    if (!terminal(this.state) && this.state.delivery?.status === "running" && !this.delivering) void this.deliver();
  }
  /** Old work is inspected or stopped, never translated into newly authorized operations. */
  private async reconcileLegacy(): Promise<void> {
    for (const [id, raw] of Object.entries(this.state.legacy!.data.jobs ?? {}) as [string, any][]) {
      try {
        const receipt = await readJson<any>(raw.receipt);
        const runId = raw.runId ?? receipt?.runId;
        const localDone = receipt?.operationId === id && "value" in receipt;
        if (localDone) { await this.transaction(() => { delete this.state.legacy!.data.jobs[id]; }); continue; }
        if (!runId) continue;
        const data = await this.ports.rpc("status", { id: runId });
        const status = data.asyncSnapshot?.runs.find(item => item.id === runId)?.state;
        if (["complete", "failed", "stopped", "rejected", "paused"].includes(status ?? "")) {
          await this.transaction(() => { delete this.state.legacy!.data.jobs[id]; });
        } else if (terminal(this.state)) await this.ports.rpc("stop", { id: runId });
      } catch (error) { this.ports.notice(`Legacy operation ${id}: ${String(error)}`, false); }
    }
  }
  async cancelWork(ids: string[]): Promise<void> {
    await this.transaction(() => {
      for (const id of ids) if (!this.state.work[id]) throw new Error(`Unknown work: ${id}`);
      for (const id of ids) {
        const job = this.state.work[id];
        if (job.status === "pending") { job.status = "cancelled"; event(this.state, `Cancelled pending work ${id}`); }
        else if (active(job)) job.cancelRequested = true;
      }
    });
    for (const id of ids) {
      const job = this.state.work[id]; this.controllers.get(id)?.abort();
      if (active(job) && job.runId) await this.ports.rpc("stop", { id: job.runId });
    }
  }
  async requestDelivery(value: unknown): Promise<void> {
    const result = compileRecord<DeliveryEvidence>(JSON.stringify(value), deliverySchema);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    await this.transaction(() => {
      this.available();
      if (Object.values(this.state.work).some(job => active(job) || job.status === "pending")) throw new Error("Finish or cancel outstanding work before delivery");
      if (this.state.decisions.length) throw new Error("Resolve pending user decisions before delivery");
      assertDelivery(this.state, result.value);
      this.state.delivery = { ...result.value, revision: this.state.revision, head: this.state.workspace.head, status: "requested" };
      this.ports.notice(`Evidence verified. Inspect ${this.state.workspace.repo}; /complex-work-verify ${this.state.revision} approves delivery.`, true);
    });
  }
  async askDecision(questions: string[]): Promise<void> {
    if (!questions.length || questions.some(q => !q.trim())) throw new Error("Provide concrete unresolved user decisions");
    await this.transaction(() => {
      this.available(); this.state.decisions = [...new Set([...this.state.decisions, ...questions])];
      this.ports.notice(`User decisions needed: ${JSON.stringify(this.state.decisions)}. Answer with /complex-work-decide and a JSON array.`, true);
    });
  }
  async userAction(action: string, argument = ""): Promise<void> {
    await this.transaction(() => {
      const s = this.state;
      if (terminal(s)) throw new Error("Mission is terminal");
      if (action === "withdraw-delivery") { if (s.delivery?.status === "running") throw new Error("Delivery is running"); s.delivery = undefined; return; }
      if (s.legacy) throw new Error("Legacy workflow is paused; cancel it and start a new mission. Artifacts are retained.");
      if (action === "pause") { s.paused = true; event(s, "User paused scheduling"); return; }
      if (action === "resume") { if (Object.values(s.work).some(job => job.status === "uncertain")) throw new Error("Reconcile uncertain work before resuming"); s.paused = false; return; }
      if (action === "policy") {
        if (Object.values(s.work).some(active) || s.delivery) throw new Error("Drain work and withdraw delivery before changing policy");
        s.policy = validatePolicy({ ...s.policy, ...JSON.parse(argument) });
        if (s.approval) s.approval.digest = approvalDigest(s);
        return;
      }
      if (action === "go") {
        if (!s.plan || Number(argument) !== s.revision || s.decisions.length) throw new Error("Approve the displayed current scope revision");
        s.approval = { revision: s.revision, digest: approvalDigest(s), at: new Date().toISOString() };
        event(s, `User approved scope ${s.revision}`); s.paused = false; return;
      }
      if (action === "decide") {
        const answers = JSON.parse(argument);
        if (!s.decisions.length || !Array.isArray(answers) || answers.length !== s.decisions.length || answers.some(a => typeof a !== "string" || !a.trim())) throw new Error("Provide one answer per pending decision");
        s.answers.push(...s.decisions.map((q, i) => `${q}: ${answers[i]}`)); s.decisions = [];
        this.wake("User decisions recorded. Reassess the next work."); return;
      }
      if (action === "approve-task") {
        const job = s.work[argument];
        if (job?.kind !== "integrate" || job.status !== "pending") throw new Error("Name a pending integration work id");
        job.integrationApproved = true; return;
      }
      if (action === "verify") {
        if (s.delivery?.status !== "requested" || Number(argument) !== s.revision || s.delivery.head !== s.workspace.head) throw new Error("Delivery requires the current requested revision and head");
        assertDelivery(s, s.delivery); s.delivery.status = "running"; event(s, "User approved delivery"); return;
      }
      throw new Error(`Unknown command: ${action}`);
    });
    if (action === "verify") await this.deliver();
  }
  private async deliver(): Promise<void> {
    if (this.delivering || this.state.delivery?.status !== "running") return;
    this.delivering = true;
    const controller = new AbortController(); this.controllers.set("delivery", controller);
    try {
      assertDelivery(this.state, this.state.delivery);
      await (this.ports.deliver ?? ((state, signal) => repository.deliver(state.workspace, signal)))(this.state, controller.signal);
      await this.transaction(() => { this.state.status = "completed"; this.state.delivery!.status = "completed"; event(this.state, "Reviewed patch delivered"); });
      this.ports.notice("Complex work completed. The reviewed patch is applied; your branch and index are unchanged.", true);
    } catch (error) {
      await this.transaction(() => { if (this.state.delivery) { this.state.delivery.status = "failed"; this.state.delivery.error = String(error); } });
      this.ports.notice(`Delivery failed: ${String(error)}`, true);
    } finally { this.delivering = false; this.controllers.delete("delivery"); }
  }
  async steer(message: string): Promise<void> {
    if (!message.trim()) throw new Error("Provide guidance");
    await this.transaction(() => { this.state.steering.push(message); event(this.state, "Guidance recorded without expanding scope"); });
    for (const job of Object.values(this.state.work).filter(active)) if (job.runId) await this.ports.rpc("steer", { id: job.runId, message, mode: "follow_up" });
    this.wake("New user guidance is available.");
  }
  async cancel(): Promise<void> {
    if (this.delivering || this.state.delivery?.status === "running") throw new Error("Wait for the approved delivery attempt to finish");
    await this.transaction(() => { this.state.status = "cancelled"; this.state.paused = true; event(this.state, "User cancelled the mission"); });
    await this.cancelWork(Object.keys(this.state.work));
    if (this.state.legacy) await this.reconcileLegacy();
  }
}
