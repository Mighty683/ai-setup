// Manual unit commands share a task dossier; pi-subagents owns execution and delivery.
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { spawnSubagent } from "../lib/complex-work/rpc.ts";

const TASK_ENTRY = "complex-work-task";
const COMMANDS = {
  research: "research",
  plan: "plan",
  sergeant: "sergeant",
  "complex-work": "research",
  "complex-work-plan": "plan",
} as const;

/** Parse only --task, leaving the user's remaining guidance intact. */
function parseRequest(args: string): { request: string; taskPath?: string } {
  const flags = [...args.matchAll(/(^|\s)--task(?=\s|$)/g)];
  if (!flags.length) return { request: args.trim() };
  if (flags.length > 1) throw new Error("Supply only one --task <path>.");
  const flag = flags[0];
  const start = flag.index!;
  const rest = args.slice(start + flag[0].length).trimStart();
  const value = /^(?:"([^"]+)"|'([^']+)'|([^\s"']+))(?=\s|$)/.exec(rest);
  const taskPath = value && (value[1] ?? value[2] ?? value[3]);
  if (!taskPath || taskPath.startsWith("--"))
    throw new Error("Use --task <path>; quote paths containing spaces.");
  return {
    taskPath,
    request: `${args.slice(0, start)} ${rest.slice(value[0].length)}`.trim(),
  };
}

/** Read session-local selection each time so reloads and session switches cannot leak it. */
function selectedTask(ctx: ExtensionContext): string | undefined {
  for (const entry of [...ctx.sessionManager.getEntries()].reverse()) {
    if (entry.type !== "custom" || entry.customType !== TASK_ENTRY) continue;
    const data = entry.data as { taskPath?: unknown } | undefined;
    if (typeof data?.taskPath === "string" && data.taskPath.trim())
      return data.taskPath;
  }
  return undefined;
}

/** Independent orders, not a workflow: never launch a next stage automatically. */
export default function complexWorkExtension(pi: ExtensionAPI): void {
  for (const [command, mode] of Object.entries(COMMANDS)) {
    pi.registerCommand(command, {
      description: `${mode} unit: [--task <path>] [objective or guidance]`,
      handler: async (args, ctx) => {
        await ctx.waitForIdle();
        try {
          const parsed = parseRequest(args);
          const chosenPath = parsed.taskPath ?? selectedTask(ctx);
          const taskPath = chosenPath
            ? path.resolve(ctx.cwd, chosenPath)
            : path.join(
                ctx.cwd,
                "docs",
                "tasks",
                `${new Date().toISOString().slice(0, 10)}-${randomUUID()}.md`,
              );
          const context = "fresh";
          const request =
            parsed.request ||
            (existsSync(taskPath)
              ? "Use the objective and relevant instructions in the task file."
              : "");
          if (!request) {
            ctx.ui.notify(
              `Provide an objective: /${command} [--task <path>] <objective>, or select an existing task file.`,
              "warning",
            );
            return;
          }
          pi.appendEntry(TASK_ENTRY, { taskPath });
          const order =
            mode === "research"
              ? "Research the objective. Save evidence-backed findings, sources, assumptions, and open questions in the task file. Do not implement or start planning."
              : mode === "plan"
                ? "Write executable assignments in the task file: scope, exact files and ownership, dependencies, waves and parallelism, acceptance criteria, and validation commands. Do not implement."
                : "Execute the task through subagents. This user order authorizes execution; no separate plan approval is required. Be the sole task-file writer: record assignment status, completion comments, evidence, validation, and blockers. Workers return results, not task-file edits.";
          const task = [
            `ORDER: ${mode}.`,
            `TASK FILE: ${taskPath}`,
            `REQUEST: ${request}`,
            "Fresh session: no parent conversation is inherited. Use this request and the task file; clarify missing objectives or material ambiguity.",
            order,
            "Read the task file first if it exists. Create it if missing. Preserve existing sections and human edits; make targeted updates, never blindly replace the dossier. Edit only the assigned task file yourself; delegate implementation only for a sergeant order.",
            "The top-level unit uses the current checkout. Give every child a complete cold-start packet and fresh context. Keep one active mutation owner per cwd/worktree. A sergeant may run independent coherent mutation waves concurrently, with one managed Git worktree and one work-unit captain per wave from a clean committed baseline. Captains coordinate parallel read-only specialists and explicit sequential writer handoffs in their assigned worktree; do not create a worktree per specialist. Serialize shared-checkout, overlapping, and dependent changes. Collect all required results before writing the dossier. Delegated research is read-only.",
            mode === "sergeant"
              ? "Use workflowScript with runs.all for concurrent wave captains. When their results gate your next action, keep the nested workflow foreground relative to you so its open tool call joins all parallel captains. If a required run detaches, use bg_wait for that exact run. Before terminal completion, inspect every wave handoff and ensure no required descendant remains queued, running, or detached."
              : "Collect every delegated result before returning.",
            "Report concisely: STATUS, TASK FILE, RESULTS, VALIDATION, BLOCKERS. Return the task path. No theatrical filler. Do not autostart another stage.",
          ].join("\n\n");
          pi.sendMessage(
            {
              customType: "complex-work",
              content: [
                `User requested /${command}: ${request}`,
                `Task file: ${taskPath}`,
                `Main agent: a fresh ${mode} unit will return through the normal subagent completion notification. Read the full result and task-file updates; retrieve saved output if truncated. Present the concise result and path. Do not autostart another stage or edit the task file while its unit is running.`,
                "The top-level unit uses this checkout. Nested agents use fresh context. Parallel mutation uses one managed worktree and one captain per independent coherent wave, with one active mutation owner inside each wave worktree. Shared-checkout, overlapping, and dependent writes remain serialized. These are independent user orders, not an approval workflow.",
              ].join("\n\n"),
              display: false,
            },
            { triggerTurn: false },
          );
          const result = await spawnSubagent(pi, {
            agent: `${mode}-unit`,
            task,
            context,
            cwd: ctx.cwd,
            async: true,
            worktree: false,
            isolation: "none",
            output: false,
            ...(ctx.model
              ? {
                  model: `${ctx.model.provider}/${ctx.model.id}:${pi.getThinkingLevel()}`,
                }
              : {}),
          });
          const runId = result.details?.runId ?? result.details?.asyncId;
          ctx.ui.notify(
            `${mode} unit started${runId ? ` (${runId})` : ""}. Task: ${taskPath}. Results will return here.`,
            "info",
          );
        } catch (error) {
          pi.sendMessage(
            {
              customType: "complex-work",
              content: `/${command}: ${String(error)}`,
              display: true,
            },
            { triggerTurn: false },
          );
          ctx.ui.notify(String(error), "error");
        }
      },
    });
  }
}
