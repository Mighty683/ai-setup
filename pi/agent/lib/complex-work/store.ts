// One durable work ledger per mission; session entries contain ownership and display pointers.
import { randomUUID } from "node:crypto";
import path from "node:path";
import { open, unlink } from "node:fs/promises";
import { Value } from "typebox/value";
import { researchBriefSchema, validateImplementationPlan, validateWorkBatch, workDefinition, workSchema } from "../complex-work-contracts.ts";
import { atomicJson, readJson } from "./io.ts";
import { createWorkspace } from "./git.ts";
import { DEFAULT_POLICY, validatePolicy, type Mission } from "./state.ts";

export const STATE_ENTRY = "complex-work-state";
export type StatePointer = { version: 2 | 3; id: string; stateFile: string; rootSessionFile: string; phase?: string; status?: string; updatedAt: string };
export function pointers(entries: readonly unknown[]): StatePointer[] {
  return entries.flatMap((entry: any) => entry?.type === "custom" && entry.customType === STATE_ENTRY
    && [2, 3].includes(entry.data?.version) && typeof entry.data.stateFile === "string" && typeof entry.data.rootSessionFile === "string" ? [entry.data as StatePointer] : []);
}
export async function loadMission(pointer: StatePointer, sessionFile: string): Promise<Mission | undefined> {
  if (pointer.rootSessionFile !== sessionFile) return undefined;
  const data = await readJson<any>(pointer.stateFile);
  if (!data || ![2, 3].includes(data.version) || data.id !== pointer.id || data.rootSessionFile !== sessionFile || data.stateFile !== pointer.stateFile) throw new Error("Invalid mission ownership or missing durable state");
  if (data.version === 2) return {
    version: 3, id: data.id, request: data.request, stateFile: data.stateFile, rootSessionFile: sessionFile,
    workspace: data.workspace, status: ["completed", "cancelled"].includes(data.phase) ? data.phase : "active",
    paused: true, policy: { ...DEFAULT_POLICY }, revision: 0, work: {}, integrations: {}, launches: 0,
    decisions: [], answers: [], steering: [], history: data.history ?? [], updatedAt: data.updatedAt,
    legacy: { version: 2, data },
  };
  const state = data as Mission;
  validatePolicy(state.policy);
  if (state.plan && !validateImplementationPlan(state.plan).ok) throw new Error("Stored scope is invalid");
  if (state.brief && !Value.Check(researchBriefSchema, state.brief)) throw new Error("Stored evidence brief is invalid");
  const definitions = Object.values(state.work).map(job => workDefinition(job));
  if (definitions.some(item => !Value.Check(workSchema, item)) || (definitions.length && !validateWorkBatch(definitions.slice(-1), definitions.slice(0, -1)).ok)) throw new Error("Stored work graph is invalid");
  for (const [id, job] of Object.entries(state.work)) {
    if (job.id !== id || !["pending", "running", "uncertain", "completed", "failed", "cancelled"].includes(job.status)) throw new Error("Invalid work ledger entry");
  }
  return state;
}
export async function createMission(cwd: string, sessionFile: string, request: string, directory: string): Promise<Mission> {
  const id = randomUUID(); const root = path.join(directory, id);
  const workspace = await createWorkspace(cwd, root);
  const state: Mission = {
    version: 3, id, request, rootSessionFile: sessionFile, stateFile: path.join(root, "state.json"),
    status: "active", paused: false, policy: { ...DEFAULT_POLICY }, workspace, revision: 0,
    work: {}, integrations: {}, launches: 0, decisions: [], answers: [], steering: [], history: [], updatedAt: new Date().toISOString(),
  };
  await atomicJson(state.stateFile, state); return state;
}
export async function saveMission(state: Mission): Promise<StatePointer> {
  state.updatedAt = new Date().toISOString(); await atomicJson(state.stateFile, state);
  return { version: 3, id: state.id, stateFile: state.stateFile, rootSessionFile: state.rootSessionFile, status: state.status, updatedAt: state.updatedAt };
}

/** A second Pi process may inspect artifacts but cannot run the same mission concurrently. */
export async function acquireMissionLease(state: Mission): Promise<() => Promise<void>> {
  const file = path.join(state.workspace.root, "controller.lock");
  const token = randomUUID();
  try {
    const handle = await open(file, "wx", 0o600);
    await handle.writeFile(JSON.stringify({ pid: process.pid, token }));
    await handle.close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const recovery = await open(`${file}.reclaim`, "wx", 0o600);
    try {
      const owner = await readJson<{ pid: number; token: string }>(file);
      if (!owner || !Number.isInteger(owner.pid)) throw new Error("Mission lease is incomplete; inspect controller.lock before recovery");
      let alive = true;
      try { process.kill(owner.pid, 0); } catch (error) { alive = (error as NodeJS.ErrnoException).code !== "ESRCH"; }
      if (alive) throw new Error(`Mission already belongs to live controller PID ${owner.pid}`);
      await unlink(file);
      return await acquireMissionLease(state);
    } finally { await recovery.close(); await unlink(`${file}.reclaim`); }
  }
  return async () => {
    const owner = await readJson<{ token: string }>(file);
    if (owner?.token === token) await unlink(file);
  };
}
