// Code-owned roles: the controller delegates leaves; agents never choose their own authority.
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const ROLE_NAMES = { scout: "complex-work-scout", synthesis: "complex-work-synthesis", planner: "complex-work-planner", writer: "complex-work-writer", reviewer: "complex-work-reviewer" } as const;
export type Role = keyof typeof ROLE_NAMES;
const descriptions: Record<Role, string> = {
  scout: "Inspect the assigned research angle. Cite concrete paths and symbols. Distinguish evidence, assumptions and missing facts. Do not plan or implement.",
  synthesis: "Synthesize supplied scout evidence. Separate implementation choices from decisions that actually require user authority. Do not invent evidence or plan implementation.",
  planner: "Create an implementation task graph from the research brief. Maximize independent tasks with explicit dependencies and file/directory/contract resources. Use measurable acceptance criteria and argv checks. Tasks can freely choose implementation details within their boundaries. Add dependencies for producer/consumer relationships. All paths are relative to the repository root. Do not implement.",
  writer: "Implement exactly the assigned task in this private checkout. Choose implementation details autonomously. You may read source, edit/write/delete scoped files, and run the approved checks. Work until acceptance is met. Report genuine scope/product decisions as blockers; ordinary bugs are yours to fix. Do not delegate. End with the requested JSON handoff.",
  reviewer: "Independently inspect actual code, supplied diff and recorded check evidence for the assigned angle. Be read-only. Report concrete findings with evidence, not speculation. Distinguish fixable in-scope defects from decisions requiring authority. Cover the supplied acceptance criteria. Do not treat a writer's report as proof.",
};
/** Registration fails closed on collisions rather than silently using a shadowed role. */
export function registerRoles(pi: ExtensionAPI): () => void {
  const registrations: { dispose(): void }[] = [];
  try {
    for (const role of Object.keys(ROLE_NAMES) as Role[]) {
      const tools = role === "writer"
        ? ["read", "grep", "find", "ls", "edit", "write", "complex_work_check", "complex_work_remove"]
        : ["read", "grep", "find", "ls"];
      const request: any = {
        version: 1, name: ROLE_NAMES[role], definition: {
          description: `Complex-work ${role}`, systemPrompt: descriptions[role], tools,
          extensions: [], subagentOnlyExtensions: [fileURLToPath(new URL("./child.ts", import.meta.url))],
          inheritSkills: false, inheritProjectContext: true, inheritGlobalContext: false,
          defaultContext: "fresh", acceptanceRole: role === "writer" ? "writer" : "read-only",
          completionGuard: false, maxSubagentDepth: 1,
        },
      };
      pi.events.emit("pi-subagents:runtime-agent-register:v1", request);
      if (!request.result?.ok) throw new Error(request.result?.error?.message ?? "pi-subagents runtime registration is unavailable");
      registrations.push(request.result.registration);
    }
  } catch (error) { for (const registration of registrations) registration.dispose(); throw error; }
  return () => { for (const registration of registrations) registration.dispose(); };
}
