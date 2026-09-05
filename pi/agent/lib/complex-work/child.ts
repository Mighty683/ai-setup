// Child-only tool boundary and durable receipts; no autonomous delegation or arbitrary shell.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { pathAllowed, type Check, type Resource } from "../complex-work-contracts.ts";
import { atomicJson, containedPath, runCheck } from "./io.ts";

export type ChildContract = {
  operationId: string; role: string; cwd: string; receipt: string;
  resources: Resource[]; checks: Check[];
};
export const READ_TOOLS = ["read", "grep", "find", "ls"];
export const WRITE_TOOLS = [...READ_TOOLS, "edit", "write", "complex_work_check", "complex_work_remove"];

/** Validate before mutation, including absolute paths and symlink ancestors. */
export async function writablePath(contract: ChildContract, input: string): Promise<string> {
  const relative = path.isAbsolute(input) ? path.relative(contract.cwd, input) : input;
  if (relative.startsWith("docs/tasks/complex-")) throw new Error("Task lifecycle records are controller-owned");
  if (contract.role !== "writer" || !pathAllowed(relative, contract.resources)) throw new Error(`Outside this writer's approved scope: ${input}`);
  return containedPath(contract.cwd, relative);
}
export default function complexWorkChild(pi: ExtensionAPI): void {
  const raw = JSON.parse(process.env.PI_SUBAGENT_EXTENSION_BINDINGS ?? "{}")["complex-work/3"];
  if (!raw) throw new Error("Complex-work roles must be launched by their controller.");
  const contract = raw as ChildContract;
  const allowed = contract.role === "writer" ? WRITE_TOOLS : READ_TOOLS;
  const receipt = (extra: Record<string, unknown>) => atomicJson(contract.receipt, {
    operationId: contract.operationId, runId: process.env.PI_SUBAGENT_RUN_ID,
    role: contract.role, updatedAt: new Date().toISOString(), ...extra,
  });
  pi.on("session_start", async () => {
    pi.setActiveTools(allowed);
    await receipt({ state: "started" });
  });
  pi.on("tool_call", async event => {
    if (!allowed.includes(event.toolName)) return { block: true, reason: `Tool ${event.toolName} is outside the ${contract.role} role.` };
    const input = event.input as Record<string, unknown>;
    try {
      if (event.toolName === "edit" || event.toolName === "write") await writablePath(contract, String(input.path ?? ""));
      if (READ_TOOLS.includes(event.toolName)) {
        const file = String(input.path ?? ".");
        await containedPath(contract.cwd, path.isAbsolute(file) ? path.relative(contract.cwd, file) : file);
      }
    } catch (error) { return { block: true, reason: String(error) }; }
  });
  pi.registerTool({
    name: "complex_work_check", label: "Approved check", description: "Run one approved check by its exact id in this task's checkout.",
    parameters: Type.Object({ id: Type.String() }),
    execute: async (_id, params, signal) => {
      if (contract.role !== "writer") throw new Error("Only writers run checks.");
      const check = contract.checks.find(item => item.id === params.id);
      if (!check) throw new Error("Unknown check; request a plan change to add commands.");
      const evidence = await runCheck(check, contract.cwd, signal);
      await atomicJson(`${contract.receipt}.${check.id}.check.json`, evidence);
      return { content: [{ type: "text", text: JSON.stringify(evidence) }], details: evidence, isError: evidence.code !== 0 };
    },
  });
  pi.registerTool({
    name: "complex_work_remove", label: "Remove scoped file", description: "Delete one file inside this writer's approved scope.",
    parameters: Type.Object({ path: Type.String() }),
    execute: async (_id, params) => {
      await unlink(await writablePath(contract, params.path));
      return { content: [{ type: "text", text: `Removed ${params.path}` }], details: {} };
    },
  });
  pi.on("agent_end", async event => {
    const last = [...event.messages].reverse().find(message => message.role === "assistant");
    if (!last || last.role !== "assistant") return;
    const output = last.content.filter(item => item.type === "text").map(item => item.text).join("\n");
    await receipt({ state: "answered", output, stopReason: last.stopReason });
  });
}
