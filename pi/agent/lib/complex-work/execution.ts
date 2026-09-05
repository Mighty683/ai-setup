// Private snapshots and local effects. No function here decides which work should happen next.
import { compileRecord, reviewResultSchema, writerResultSchema, type Check, type ReviewResult, type WriterResult } from "../complex-work-contracts.ts";
import { durableCheck } from "./checks.ts";
import { assertIntegration, resultSnapshot } from "./evidence.ts";
import * as repository from "./git.ts";
import { writable, type Job, type Mission, type Snapshot, type WorkResult } from "./state.ts";
import type { CheckEvidence } from "./io.ts";

/** Select once before dispatch; restarting must not silently use a newer integration revision. */
export function captureInput(state: Mission, job: Job): Snapshot {
  const source = job.input ? resultSnapshot(state, job.input) : {
    cwd: state.workspace.repo, base: job.taskId ? state.workspace.head : state.workspace.baseline,
    candidate: state.workspace.head, integratedHead: state.workspace.head, revision: state.revision,
  };
  if (job.taskId && source.taskId && job.taskId !== source.taskId) throw new Error("Input snapshot belongs to a different approved task");
  if ((job.kind === "review" || job.kind === "check" || job.kind === "integrate") && source.taskId !== job.taskId) throw new Error("Evidence task must match its input snapshot");
  if (job.kind !== "agent" && source.revision !== job.revision) throw new Error("Input evidence belongs to an older scope revision");
  return { ...source, taskId: job.taskId, revision: job.revision,
    base: writable(job) && !source.taskId ? source.candidate : source.base };
}
export async function prepareAgent(state: Mission, job: Job): Promise<string> {
  const source = job.snapshot!;
  return repository.createCheckout({ ...state.workspace, repo: source.cwd }, job.operationId, source.candidate);
}
export async function collectAgentResult(state: Mission, job: Job, output: string): Promise<WorkResult> {
  const snapshot = { ...job.snapshot!, cwd: job.cwd! };
  const after = await repository.checkpoint(job.cwd!, `Agent result ${job.id}`);
  if (writable(job)) {
    const task = state.plan!.tasks.find(item => item.id === job.taskId)!;
    await repository.assertScope(job.cwd!, snapshot.base, after, task.resources, "");
    snapshot.candidate = after;
  } else if ((await repository.changedFiles(job.cwd!, snapshot.candidate, after)).length) throw new Error("Read-only agent modified its snapshot");
  const result: WorkResult = { snapshot, output };
  if (job.kind === "review") {
    const parsed = compileRecord<ReviewResult>(output, reviewResultSchema);
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    const report = parsed.value;
    const criteria = job.taskId ? state.plan!.tasks.find(item => item.id === job.taskId)!.criteria : state.plan!.acceptanceCriteria.map(item => item.id);
    if (report.coveredCriteria.some(id => !criteria.includes(id))) throw new Error("Review references an unknown criterion");
    if (report.verdict === "pass" && report.findings.some(item => item.severity !== "P2")) throw new Error("Passing review contains blocking findings");
    if (report.verdict !== "pass" && !report.findings.length) throw new Error("Blocking review requires concrete findings");
    result.review = report;
  }
  return result;
}
/** Failures retain their snapshots so the model can explicitly build a correction from them. */
export function resultError(job: Job, result: WorkResult): string | undefined {
  if (job.kind === "check" && result.checks?.some(e => e.code !== 0 || e.timedOut || e.cancelled)) return "Approved checks failed; inspect saved command evidence";
  if (writable(job)) {
    const parsed = compileRecord<WriterResult>(result.output ?? "", writerResultSchema);
    if (!parsed.ok) return parsed.errors.join("\n");
    if (parsed.value.status === "blocked" || parsed.value.blockers.length) return parsed.value.blockers.map(item => item.message).join("\n") || parsed.value.summary;
  }
  return undefined;
}
export async function runLocal(state: Mission, job: Job, signal: AbortSignal): Promise<WorkResult> {
  if (job.kind === "check") {
    const source = job.snapshot!;
    const cwd = await repository.createCheckout({ ...state.workspace, repo: source.cwd }, job.operationId, source.candidate);
    const checks = job.taskId ? state.plan!.tasks.find(item => item.id === job.taskId)!.checks : state.plan!.finalChecks;
    const evidence = await checkAll(checks, cwd, signal, job.receipt);
    const after = await repository.checkpoint(cwd, `Check result ${job.id}`);
    if ((await repository.changedFiles(cwd, source.candidate, after)).length) throw new Error("Checks changed source; submit a write assignment and obtain fresh evidence");
    return { snapshot: { ...source, cwd }, checks: evidence };
  }
  if (job.kind === "integrate") {
    const source = assertIntegration(state, job);
    const previous = state.integrations[job.taskId];
    if (previous) await repository.git(source.cwd, ["merge-base", "--is-ancestor", previous.head, source.base]);
    const cwd = await repository.integrationCandidate(state.workspace, job.operationId, source);
    const before = await repository.checkpoint(cwd, `Integration candidate ${job.id}`);
    const checks = await checkAll(state.plan!.tasks.find(item => item.id === job.taskId)!.checks, cwd, signal, job.receipt);
    if (checks.some(e => e.code !== 0 || e.timedOut || e.cancelled)) throw new Error("Integration checks failed; evidence retained alongside the work receipt");
    const head = await repository.checkpoint(cwd, `Integration checks ${job.id}`);
    if ((await repository.changedFiles(cwd, before, head)).length) throw new Error("Integration checks changed reviewed source");
    if (signal.aborted) throw new Error("Integration cancelled");
    await repository.adopt(state.workspace, cwd, head);
    return { snapshot: { cwd, base: state.workspace.baseline, candidate: head, integratedHead: head, revision: job.revision }, head, checks };
  }
  throw new Error(`Unsupported local operation ${job.kind}`);
}
async function checkAll(checks: Check[], cwd: string, signal: AbortSignal, receipt: string): Promise<CheckEvidence[]> {
  const evidence: CheckEvidence[] = [];
  for (const check of checks) {
    const result = await durableCheck(check, cwd, `${receipt}.checks`, signal);
    evidence.push(result);
    if (result.code !== 0 || result.timedOut || result.cancelled) break;
  }
  return evidence;
}
