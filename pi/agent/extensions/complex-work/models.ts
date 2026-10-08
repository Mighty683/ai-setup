/** Planning catalog from authenticated registry data and public, side-effect-free subagent preflight. */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { resolveSubagentLaunchContract as Preflight } from "../../npm/node_modules/pi-subagents/src/api/preflight.js";

const require = createRequire(new URL("../../npm/package.json", import.meta.url));

export async function planningModels(ctx: ExtensionContext, root: string): Promise<string> {
  const module = await import(pathToFileURL(require.resolve("pi-subagents/preflight")).href);
  const preflight = module.resolveSubagentLaunchContract as typeof Preflight;
  const available = ctx.modelRegistry.getAvailable();
  const snapshot = (ctx as ExtensionContext & { scopedModels?: readonly { model: { provider: string; id: string } }[] }).scopedModels ?? [];
  const scoped = snapshot.map(item => `${item.model.provider}/${item.model.id}`);
  const candidates = available.filter(model => !scoped.length || scoped.includes(`${model.provider}/${model.id}`)).slice(0, 64);
  const lines: string[] = [];
  for (const model of candidates) {
    const id = `${model.provider}/${model.id}`;
    const roles: string[] = [];
    for (const agent of ["complex-worker", "complex-integrator"]) {
      const result = await preflight({ agent, cwd: root, model: id, context: "fresh", thinking: false,
        parentModel: ctx.model, parentSessionId: ctx.sessionManager.getSessionId(), availableModels: available,
        scopedModelIds: scoped, skill: false, outputSchema: false });
      if (result.ok) roles.push(agent);
    }
    if (roles.length) lines.push(`- ${id} | roles: ${roles.join(", ")} | reasoning: ${model.reasoning} | context: ${model.contextWindow} | registry input/output cost: ${model.cost.input}/${model.cost.output}`);
  }
  return ["Task-model catalog (registry snapshot, up to 64 candidates; not a performance benchmark):",
    ...lines, lines.length ? "Recommend exact IDs from this list, task-specific effort, rationale, and an approved fallback. Recheck policy at launch." : "No eligible delegate models verified. Ask the user through interview; do not invent IDs.",
    "Recommendations belong in Markdown and need separate user authorization before model assignment. Never change stage agents, models, or workflow state automatically."].join("\n");
}
