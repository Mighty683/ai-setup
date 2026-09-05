// Register model-defined assignments with controller-owned capabilities and child guards.
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Assignment } from "../complex-work-contracts.ts";
import { READ_TOOLS, WRITE_TOOLS } from "./child.ts";

/** Each operation gets an isolated identity, even when the model reuses a display name. */
export function registerAssignment(pi: ExtensionAPI, operationId: string, assignment: Assignment, writable: boolean): { name: string; dispose(): void } {
  const name = `complex-work-${operationId}`;
  const request: any = {
    version: 1, name, definition: {
      description: assignment.name, systemPrompt: assignment.instructions,
      tools: writable ? WRITE_TOOLS : READ_TOOLS,
      extensions: [], subagentOnlyExtensions: [fileURLToPath(new URL("./child.ts", import.meta.url))],
      inheritSkills: false, inheritProjectContext: true, inheritGlobalContext: false,
      defaultContext: "fresh", acceptanceRole: writable ? "writer" : "read-only",
      completionGuard: false, maxSubagentDepth: 1,
    },
  };
  pi.events.emit("pi-subagents:runtime-agent-register:v1", request);
  if (!request.result?.ok) throw new Error(request.result?.error?.message ?? "pi-subagents runtime registration is unavailable");
  return { name, dispose: () => request.result.registration.dispose() };
}
