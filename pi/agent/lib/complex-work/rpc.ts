// Public pi-subagents RPC adapter. Timeouts remain uncertain until status/receipts reconcile them.
import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readJson } from "./io.ts";
import path from "node:path";
import type { Job } from "./state.ts";

export class RpcError extends Error {
  uncertain: boolean;
  constructor(message: string, uncertain = false) { super(message); this.uncertain = uncertain; }
}
export type RpcData = { details?: { runId?: string; asyncId?: string; asyncDir?: string; [key: string]: unknown }; asyncSnapshot?: { runs: { id: string; state: string }[] }; [key: string]: unknown };
export type Rpc = (method: "spawn" | "status" | "stop" | "steer", params: Record<string, unknown>) => Promise<RpcData>;
export function createRpc(pi: ExtensionAPI, timeoutMs = 10_000): Rpc {
  return (method, params) => new Promise((resolve, reject) => {
    const requestId = randomUUID();
    const replyEvent = `subagents:rpc:v1:reply:${requestId}`;
    let unsubscribe: (() => void) | undefined;
    const timer = setTimeout(() => { unsubscribe?.(); reject(new RpcError(`${method} acknowledgement timed out`, true)); }, timeoutMs);
    unsubscribe = pi.events.on(replyEvent, (raw: any) => {
      clearTimeout(timer); unsubscribe?.();
      if (!raw?.success) reject(new RpcError(raw?.error?.message ?? `${method} failed`));
      else resolve(raw.data ?? {});
    });
    pi.events.emit("subagents:rpc:v1:request", { version: 1, requestId, method, params, source: { extension: "complex-work" } });
  });
}
export type Receipt = { operationId: string; runId?: string; role: string; state: string; output?: string; stopReason?: string };
export type RunStatus = { state: string; output?: string; runId?: string };
/** Durable child receipts contain full output; runtime terminal state remains the completion authority. */
export async function inspectRun(job: Job, rpc: Rpc): Promise<RunStatus> {
  const receipt = await readJson<Receipt>(job.receipt);
  if (receipt && receipt.operationId !== job.operationId) throw new Error("Mismatched child receipt");
  const runId = job.runId ?? receipt?.runId;
  if (!runId) return { state: "unknown" };
  const response = await rpc("status", { id: runId });
  let state = response.asyncSnapshot?.runs.find(run => run.id === runId)?.state;
  if (!state && job.asyncDir) {
    const status = await readJson<{ runId: string; state: string }>(path.join(job.asyncDir, "status.json"));
    if (status?.runId === runId) state = status.state;
  }
  return { state: state ?? "unknown", runId, output: receipt?.output };
}
