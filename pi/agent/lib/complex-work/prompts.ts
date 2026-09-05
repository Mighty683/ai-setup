// Inputs are explicit dependencies and immutable evidence; agents never choose their authority.
import { reviewResultSchema, writerResultSchema } from "../complex-work-contracts.ts";
import type { Mission, Job } from "./state.ts";
import { writable } from "./state.ts";
import { patch } from "./git.ts";

export async function prompt(state: Mission, job: Job): Promise<string> {
  const task = state.plan?.tasks.find(item => item.id === job.taskId);
  const parts = [
    `Request: ${state.request}`, `Guidance: ${JSON.stringify(state.steering)}`,
    `User decisions: ${JSON.stringify(state.answers)}`,
    `Assignment: ${JSON.stringify("assignment" in job ? job.assignment : undefined)}`,
    `Approved scope: ${JSON.stringify({ task, constraints: state.plan?.constraints, criteria: state.plan?.acceptanceCriteria })}`,
    `Input revision: ${JSON.stringify(job.snapshot)}`,
    `Dependency results: ${JSON.stringify(job.dependsOn.map(id => ({ id, status: state.work[id].status, result: state.work[id].result, error: state.work[id].error })))}`,
    "Work only inside your assigned checkout and capability boundary. Do not delegate.",
  ];
  if (writable(job)) parts.push(`Run approved commands through complex_work_check. End with a fenced JSON handoff matching ${JSON.stringify(writerResultSchema)}.`);
  else parts.push("Inspect source read-only and distinguish evidence from assumptions.");
  if (job.kind === "review") {
    parts.push(`Inspect the actual source, this exact diff, and any supplied check evidence. Relevant criterion IDs: ${JSON.stringify(task?.criteria ?? state.plan!.acceptanceCriteria.map(item => item.id))}. Report the criteria your assignment actually covers; the selected reviews must collectively cover all required criteria.`);
    parts.push(await patch(job.cwd!, job.snapshot!.base, job.snapshot!.candidate));
    parts.push(`End with a fenced JSON record matching ${JSON.stringify(reviewResultSchema)}. A pass must contain no P0/P1 findings; other verdicts require concrete findings. Do not treat another agent's claims as proof.`);
  }
  return parts.join("\n\n");
}
