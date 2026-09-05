// Durable bookkeeping: work status, authority and evidence. The model owns the workflow graph.
import { createHash } from "node:crypto";
import type { ImplementationPlan, ResearchBrief, ReviewResult, WorkDefinition, DeliveryEvidence } from "../complex-work-contracts.ts";
import type { CheckEvidence } from "./io.ts";
import type { Workspace } from "./git.ts";

export type Policy = { maxAgents: number; maxChecks: number; maxLaunches: number; maxWorkItems: number; runTimeoutMs: number; checkpoints: "final" | "task" };
export const DEFAULT_POLICY: Policy = { maxAgents: 4, maxChecks: 2, maxLaunches: 128, maxWorkItems: 512, runTimeoutMs: 3_600_000, checkpoints: "final" };
export type WorkStatus = "pending" | "running" | "uncertain" | "completed" | "failed" | "cancelled";

/** Evidence names the exact immutable candidate, its patch base and integration context. */
export type Snapshot = { cwd: string; base: string; candidate: string; integratedHead: string; revision: number; taskId?: string };
export type WorkResult = { snapshot: Snapshot; output?: string; review?: ReviewResult; checks?: CheckEvidence[]; head?: string };
export type Job = WorkDefinition & {
  status: WorkStatus; revision: number; operationId: string; receipt: string;
  createdAt: string; finishedAt?: string; error?: string;
  runId?: string; asyncDir?: string; cwd?: string; snapshot?: Snapshot; result?: WorkResult;
  cancelRequested?: boolean;
  integrationApproved?: boolean;
};
export type Integration = { workId: string; head: string; candidate: string; revision: number };
export type Mission = {
  version: 3; id: string; rootSessionFile: string; stateFile: string; request: string;
  status: "active" | "completed" | "cancelled"; paused: boolean; policy: Policy; workspace: Workspace;
  revision: number; approval?: { revision: number; digest: string; at: string };
  plan?: ImplementationPlan; brief?: ResearchBrief; work: Record<string, Job>; integrations: Record<string, Integration>;
  launches: number; decisions: string[]; answers: string[]; steering: string[];
  delivery?: DeliveryEvidence & { revision: number; head: string; status: "requested" | "running" | "failed" | "completed"; error?: string };
  legacy?: { version: number; data: any };
  history: { at: string; message: string }[]; updatedAt: string;
};
export function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function approvalDigest(state: Mission): string { return digest({ plan: state.plan, policy: state.policy, revision: state.revision }); }
export function approved(state: Mission): boolean { return state.approval?.revision === state.revision && state.approval.digest === approvalDigest(state); }
export function terminal(state: Mission): boolean { return state.status !== "active"; }
export function isAgent(job: Pick<Job, "kind">): boolean { return job.kind === "agent" || job.kind === "review"; }
export function active(job: Job): boolean { return job.status === "running" || job.status === "uncertain"; }
export function writable(job: Job): boolean { return job.kind === "agent" && job.access === "write"; }
export function event(state: Mission, message: string): void {
  state.updatedAt = new Date().toISOString(); state.history.push({ at: state.updatedAt, message });
}
export function validatePolicy(value: unknown): Policy {
  const policy = { ...DEFAULT_POLICY, ...(value as object) } as Policy;
  const bounds = { maxAgents: [1, 16], maxChecks: [1, 8], maxLaunches: [1, 1024], maxWorkItems: [1, 4096], runTimeoutMs: [10_000, 7_200_000] };
  for (const [key, [min, max]] of Object.entries(bounds)) {
    const n = policy[key as keyof typeof bounds];
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Invalid policy ${key}: expected ${min}..${max}`);
  }
  if (!["final", "task"].includes(policy.checkpoints)) throw new Error("Invalid checkpoints policy");
  if (Object.keys(policy).some(key => !(key in DEFAULT_POLICY))) throw new Error("Unknown policy field");
  return policy;
}
