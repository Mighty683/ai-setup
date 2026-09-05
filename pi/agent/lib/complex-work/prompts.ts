// Role-specific inputs contain immutable task contracts and evidence, never orchestration authority.
import { planSchema, researchBriefSchema, reviewResultSchema, writerResultSchema } from "../complex-work-contracts.ts";
import type { Mission, Job } from "./state.ts";

export function taskRecord(state: Mission, taskId: string): string { return `docs/tasks/complex-${state.id.slice(0, 8)}-r${state.revision}-${taskId}.md`; }
export function prompt(state: Mission, job: Job, diff = ""): string {
  const task = state.plan?.tasks.find(task => task.id === job.taskId);
  const lane = job.taskId ? state.tasks[job.taskId] : undefined;
  const common = [`Request: ${state.request}`, `Current user guidance: ${JSON.stringify(state.steering)}`];
  if (job.kind === "scout" && !task) return [...common, `Research angle: ${job.angle}. Inspect source read-only. Report concrete evidence, constraints, and genuinely unresolved user decisions. Do not implement.`].join("\n\n");
  if (job.kind === "synthesis") return [...common, `Scout reports: ${JSON.stringify(state.reports)}`, `Compile evidence into this schema: ${JSON.stringify(researchBriefSchema)}`, repair(state)].join("\n\n");
  if (job.kind === "planner") return [...common, `Authoritative brief: ${JSON.stringify(state.brief)}`, `Previous plan and correction context: ${JSON.stringify({ plan: state.plan, tasks: state.tasks, finalReviews: state.finalReviews, errors: state.errors })}`, `Return a complete replacement task graph using this schema: ${JSON.stringify(planSchema)}. All paths/check cwd are repository-root relative. Checks use command + args with no implicit shell. Include any dependency setup as explicit approved argv checks. Do not assume ignored dependencies exist in private checkouts.`, repair(state)].join("\n\n");
  const evidence = { task, criteria: state.plan?.acceptanceCriteria, constraints: state.plan?.constraints, research: state.brief, scout: lane?.scout, error: lane?.error, checks: lane?.checks, reviews: lane?.reviews };
  if (job.kind === "scout") return [...common, `Focused task reconnaissance: ${JSON.stringify(evidence)}`, "Identify exact implementation seams and focused risks. The controller will give your report to the writer. Do not implement or delegate."].join("\n\n");
  if (job.kind === "writer") return [...common, `Approved task and prior evidence: ${JSON.stringify(evidence)}`, `You may run complex_work_check with these ids: ${task?.checks.map(check => check.id).join(", ")}. The controller records the task lifecycle; concentrate on implementation.`, `Return Markdown ending with one JSON fence matching: ${JSON.stringify(writerResultSchema)}`].join("\n\n");
  return [...common, `Review angle: ${job.angle}. Read the actual source in this immutable checkout.`, `Evidence: ${JSON.stringify(task ? evidence : { plan: state.plan, checks: state.finalChecks, tasks: state.tasks })}`, `Exact reviewed diff:\n${diff}`, `Cover these criterion IDs: ${JSON.stringify(task?.criteria ?? state.plan?.acceptanceCriteria.map(item => item.id))}`, `Return Markdown ending with one JSON fence matching: ${JSON.stringify(reviewResultSchema)}. A pass must have no P0/P1 findings. A fix or decision must include concrete findings. For final-review fixes, name the existing taskId whose approved scope contains the correction; use decision when no existing task can safely own it.`].join("\n\n");
}
function repair(state: Mission): string { return `End with a valid fenced JSON record. Prior invalid draft: ${state.draft ?? "none"}\nCompiler errors: ${JSON.stringify(state.errors)}`; }
