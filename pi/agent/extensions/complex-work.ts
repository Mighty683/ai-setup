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

function hasObjectiveHistory(ctx: ExtensionContext): boolean {
  return ctx.sessionManager
    .getBranch()
    .some(
      (entry) =>
        (entry.type === "message" &&
          entry.message.role === "user" &&
          (typeof entry.message.content === "string"
            ? entry.message.content.trim().length > 0
            : entry.message.content.some(
                (part) => part.type === "text" && part.text.trim().length > 0,
              ))) ||
        (entry.type === "compaction" && !!entry.summary.trim()) ||
        (entry.type === "branch_summary" && !!entry.summary.trim()),
    );
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
          // Decide before appendEntry/sendMessage can create a leaf in an empty session.
          const sessionFile = ctx.sessionManager.getSessionFile();
          const context =
            sessionFile &&
            existsSync(sessionFile) &&
            ctx.sessionManager.getLeafId()
              ? "fork"
              : "fresh";
          const request =
            parsed.request ||
            (existsSync(taskPath)
              ? "Use the objective and relevant instructions in the task file."
              : context === "fork" && hasObjectiveHistory(ctx)
                ? "Use the objective, context, and user feedback in the current conversation."
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
            context === "fresh"
              ? "Fresh session: no parent conversation is inherited. Use this request and the task file; clarify missing objectives or material ambiguity."
              : "Use the forked conversation as supporting context; the selected task file is the shared artifact.",
            order,
            "Read the task file first if it exists. Create it if missing. Preserve existing sections and human edits; make targeted updates, never blindly replace the dossier. Edit only the assigned task file yourself; delegate implementation only for a sergeant order.",
            "Use the current shared checkout with worktree: false and isolation: none; do not create worktrees. One writer per cwd: serialize implementation writers, even for disjoint files. Parallelize read-only research/review; collect results before writing the dossier. Delegated research is read-only.",
            "Report concisely: STATUS, TASK FILE, RESULTS, VALIDATION, BLOCKERS. Return the task path. No theatrical filler. Do not autostart another stage.",
          ].join("\n\n");
          pi.sendMessage(
            {
              customType: "complex-work",
              content: [
                `User requested /${command}: ${request}`,
                `Task file: ${taskPath}`,
                `Main agent: a ${context} ${mode} unit will return through the normal subagent completion notification. Read the full result and task-file updates; retrieve saved output if truncated. Present the concise result and path. Do not autostart another stage or edit the task file while its unit is running.`,
                "All agents share this checkout. Coordinate one writer per cwd; serialize implementation writers and parallelize read-only work. These are independent user orders, not an approval workflow.",
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
