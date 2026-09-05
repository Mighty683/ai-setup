// User commands launch forked agents; pi-subagents owns execution and result delivery.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawnSubagent } from "../lib/complex-work/rpc.ts";

/** Research and planning are independent requests. Implementation follows user acceptance. */
export default function complexWorkExtension(pi: ExtensionAPI): void {
  for (const mode of ["research", "plan"] as const) {
    const command = mode === "research" ? "complex-work" : "complex-work-plan";
    pi.registerCommand(command, {
      description: `Fork the current conversation for ${mode}; optional request or guidance`,
      handler: async (args, ctx) => {
        await ctx.waitForIdle();
        if (!ctx.sessionManager.getSessionFile()) {
          ctx.ui.notify("A persisted conversation is required to fork an agent.", "error");
          return;
        }
        const request = args.trim() || "Use the current conversation, including prior research and user feedback.";
        const handoff = mode === "research"
          ? "Present the research findings to the user. Wait for the user to request planning with /complex-work-plan."
          : "Present the complete implementation plan to the user and wait for their explicit acceptance. After acceptance, the main agent implements the plan and may spawn subagents. Present the finished work for user acceptance or correction.";
        pi.sendMessage({
          customType: "complex-work",
          content: [
            `User requested /${command}: ${request}`,
            `A forked ${mode} agent will return through the normal subagent completion notification.`,
            `Main agent: read its full result, retrieving the saved output if the notification is truncated. ${handoff}`,
            "This command authorizes research or planning only. Remain read-only for this request until the user accepts a plan. Agents may delegate; all work uses the current shared checkout without worktrees. Coordinate file ownership before parallel edits.",
          ].join("\n\n"),
          display: false,
        }, { triggerTurn: false });
        try {
          const result = await spawnSubagent(pi, {
            agent: mode === "research" ? "research-unit" : "plan-unit",
            task: `Perform ${mode} for this request: ${request}\n\nReturn the ${mode === "research" ? "research findings" : "implementation plan"} to the parent for user review. Do not implement changes. You may delegate read-only subtasks in the same checkout without worktrees; collect their results before answering.`,
            context: "fork",
            cwd: ctx.cwd,
            async: true,
            worktree: false,
            isolation: "none",
            output: false,
            ...(ctx.model ? { model: `${ctx.model.provider}/${ctx.model.id}:${pi.getThinkingLevel()}` } : {}),
          });
          const runId = result.details?.runId ?? result.details?.asyncId;
          ctx.ui.notify(`${mode === "research" ? "Research" : "Plan"} agent started${runId ? ` (${runId})` : ""}. Results will return here.`, "info");
        } catch (error) {
          pi.sendMessage({ customType: "complex-work", content: `/${command}: ${String(error)}`, display: true }, { triggerTurn: false });
          ctx.ui.notify(String(error), "error");
        }
      },
    });
  }
}
