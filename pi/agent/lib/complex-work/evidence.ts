// Integration and delivery require observed evidence for the exact candidate and approval revision.
import type { DeliveryEvidence } from "../complex-work-contracts.ts";
import { approved, type Job, type Mission, type Snapshot } from "./state.ts";

export function sameSnapshot(a: Snapshot | undefined, b: Snapshot): boolean {
  return !!a && a.candidate === b.candidate && a.base === b.base && a.taskId === b.taskId && a.revision === b.revision;
}
export function resultSnapshot(state: Mission, id: string): Snapshot {
  const job = state.work[id];
  if (!["completed", "failed"].includes(job?.status) || !job.result?.snapshot) throw new Error(`No terminal snapshot for ${id}`);
  return job.result.snapshot;
}
export function assertEvidence(state: Mission, snapshot: Snapshot, references: DeliveryEvidence): void {
  if (!approved(state) || snapshot.revision !== state.revision) throw new Error("Evidence requires current scope approval");
  const task = state.plan!.tasks.find(item => item.id === snapshot.taskId);
  const required = task?.checks ?? state.plan!.finalChecks;
  const criteria = task?.criteria ?? state.plan!.acceptanceCriteria.map(item => item.id);
  if (!references.checks.length || !references.reviews.length) throw new Error("Checks and independent review evidence are required");
  for (const id of references.checks) {
    const job = state.work[id];
    if (job?.kind !== "check" || job.status !== "completed" || !sameSnapshot(job.result?.snapshot, snapshot)) throw new Error(`Stale or missing check evidence: ${id}`);
    if (required.some(check => !job.result!.checks?.some(e => JSON.stringify(e.check) === JSON.stringify(check) && e.code === 0 && !e.timedOut && !e.cancelled))) throw new Error(`Incomplete or failed checks: ${id}`);
  }
  for (const id of references.reviews) {
    const job = state.work[id];
    const review = job?.result?.review;
    if (job?.kind !== "review" || job.status !== "completed" || !sameSnapshot(job.result?.snapshot, snapshot)
      || !review || review.verdict !== "pass" || review.coveredCriteria.some(id => !criteria.includes(id))
      || review.findings.some(item => item.severity !== "P2")) throw new Error(`Stale, incomplete or blocking review: ${id}`);
  }
  const coverage = new Set(references.reviews.flatMap(id => state.work[id].result!.review!.coveredCriteria));
  if (criteria.some(id => !coverage.has(id))) throw new Error("Selected independent reviews do not cover every required criterion");
  // Selecting a favorable report cannot hide another recorded blocker on the same candidate.
  if (Object.values(state.work).some(job => sameSnapshot(job.result?.snapshot, snapshot)
    && ((job.kind === "review" && job.result?.review && job.result.review.verdict !== "pass")
      || (job.kind === "check" && job.result?.checks?.some(e => e.code !== 0 || e.timedOut || e.cancelled)
        && !references.checks.some(id => state.work[id].dependsOn.includes(job.id) && state.work[id].allowFailed?.includes(job.id)))))) {
    throw new Error("This candidate has unresolved failing evidence; correct it and collect fresh evidence");
  }
}
export function assertIntegration(state: Mission, job: Job): Snapshot {
  if (job.kind !== "integrate") throw new Error("Expected integration operation");
  const snapshot = resultSnapshot(state, job.input);
  if (snapshot.taskId !== job.taskId) throw new Error("Integration candidate belongs to a different task");
  if (state.integrations[job.taskId]?.candidate === snapshot.candidate) throw new Error("This candidate was already integrated");
  assertEvidence(state, snapshot, job);
  return snapshot;
}
export function assertDelivery(state: Mission, refs: DeliveryEvidence): Snapshot {
  if (!state.plan || !approved(state)) throw new Error("Approve scope before delivery");
  if (state.plan.tasks.some(task => state.integrations[task.id]?.revision !== state.revision)) throw new Error("Not every approved task has been integrated");
  const snapshot: Snapshot = { cwd: state.workspace.repo, base: state.workspace.baseline, candidate: state.workspace.head,
    integratedHead: state.workspace.head, revision: state.revision };
  assertEvidence(state, snapshot, refs);
  return snapshot;
}
