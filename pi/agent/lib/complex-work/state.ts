// Durable mission state and pure scheduling rules, independent of Pi and process execution.
import { createHash } from "node:crypto";
import type { ImplementationPlan, ResearchBrief, ReviewResult, Task } from "../complex-work-contracts.ts";
import { resourcesConflict } from "../complex-work-contracts.ts";
import type { CheckEvidence } from "./io.ts";
import type { Workspace } from "./git.ts";
import type { Role } from "./roles.ts";

export type Policy = { maxAgents: number; maxChecks: number; maxRepairs: number; maxAttempts: number; maxLaunches: number; runTimeoutMs: number; checkpoints: "final" | "task" };
export const DEFAULT_POLICY: Policy = { maxAgents: 4, maxChecks: 2, maxRepairs: 2, maxAttempts: 3, maxLaunches: 128, runTimeoutMs: 3_600_000, checkpoints: "final" };
export type Phase = "researching" | "synthesizing" | "research-decision" | "planning" | "awaiting-approval" | "running" | "final-checks" | "final-review" | "awaiting-delivery" | "completed" | "cancelled" | "blocked";
export type TaskStage = "pending" | "preparing" | "scouting" | "scouted" | "writing" | "written" | "checking" | "reviewing" | "ready" | "integrating" | "done" | "blocked";
export const REVIEW_ANGLES = ["correctness", "acceptance", "maintainability"] as const;
export const RESEARCH_ANGLES = ["architecture", "validation", "contracts", "risks"] as const;
export type TaskState = {
  stage: TaskStage; repairs: number; attempts: Record<string, number>; version: number;
  cwd?: string; base?: string; candidate?: string; scout?: string; handoff?: string;
  checks?: CheckEvidence[]; reviews: Record<string, ReviewResult>; error?: string;
  decision?: boolean; checkpointApproved?: boolean; completedAt?: string;
};
export type JobKind = Role | "prepare" | "validate" | "integrate" | "final-check" | "deliver";
export type Job = {
  id: string; kind: JobKind; taskId?: string; angle?: string; revision: number;
  status: "launching" | "running" | "uncertain"; runId?: string; asyncDir?: string;
  receipt: string; cwd: string; createdAt: string; error?: string;
};
export type Mission = {
  version: 2; id: string; rootSessionFile: string; stateFile: string; request: string;
  phase: Phase; paused: boolean; policy: Policy; workspace: Workspace;
  revision: number; approval?: { revision: number; digest: string; at: string };
  plan?: ImplementationPlan; brief?: ResearchBrief; draft?: string; errors: string[];
  reports: Record<string, string>; discoveryAttempts: Record<string, number>;
  tasks: Record<string, TaskState>; jobs: Record<string, Job>; launches: number;
  finalChecks?: CheckEvidence[]; finalReviews: Record<string, ReviewResult>;
  steering: string[]; history: { at: string; message: string }[]; updatedAt: string;
};
export function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function approvalDigest(state: Mission): string { return digest({ plan: state.plan, policy: state.policy, revision: state.revision }); }
export function approved(state: Mission): boolean { return state.approval?.revision === state.revision && state.approval.digest === approvalDigest(state); }
export function freshTask(): TaskState { return { stage: "pending", repairs: 0, attempts: {}, version: 0, reviews: {} }; }
export function terminal(state: Mission): boolean { return state.phase === "completed" || state.phase === "cancelled"; }
export function isAgent(kind: JobKind): kind is Role { return ["scout", "synthesis", "planner", "writer", "reviewer"].includes(kind); }
export function event(state: Mission, message: string): void {
  state.updatedAt = new Date().toISOString();
  state.history.push({ at: state.updatedAt, message });
}
export function canStartTask(state: Mission, task: Task): boolean {
  if (state.tasks[task.id].stage !== "pending") return false;
  if (!task.dependsOn.every(id => state.tasks[id].stage === "done")) return false;
  const activeTasks = state.plan!.tasks.filter(other => !["pending", "done", "blocked"].includes(state.tasks[other.id].stage));
  return activeTasks.every(other => other.resources.every(a => task.resources.every(b => !resourcesConflict(a, b))));
}
/** Favor tasks that unlock the longest dependency chain; ties preserve the approved plan order. */
export function orderedTasks(plan: ImplementationPlan): Task[] {
  const weights = new Map<string, number>();
  const weight = (id: string): number => {
    if (weights.has(id)) return weights.get(id)!;
    const next = plan.tasks.filter(task => task.dependsOn.includes(id));
    const value = 1 + Math.max(0, ...next.map(task => weight(task.id)));
    weights.set(id, value); return value;
  };
  return [...plan.tasks].sort((a, b) => weight(b.id) - weight(a.id));
}
export function validatePolicy(value: unknown): Policy {
  const policy = { ...DEFAULT_POLICY, ...(value as object) } as Policy;
  const bounds = { maxAgents: [1, 16], maxChecks: [1, 8], maxRepairs: [0, 8], maxAttempts: [1, 8], maxLaunches: [1, 1024], runTimeoutMs: [10_000, 7_200_000] };
  for (const [key, [min, max]] of Object.entries(bounds)) {
    const n = policy[key as keyof typeof bounds];
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Invalid policy ${key}: expected ${min}..${max}`);
  }
  if (!["final", "task"].includes(policy.checkpoints)) throw new Error("checkpoints must be final or task");
  if (Object.keys(policy).some(key => !(key in DEFAULT_POLICY))) throw new Error("Unknown policy field");
  return policy;
}
