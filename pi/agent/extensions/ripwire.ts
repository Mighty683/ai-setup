// Ripwire task-context tool. Runs the user's installed CLI against the current workspace;
// it never downloads repositories or exposes Ripwire's command-execution/write flags.
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "ripwire",
    label: "Ripwire",
    description:
      "Find relevant code and context for a development task in the current working directory using the installed ripwire CLI. Read-only; output is capped at 2000 lines or 50KB.",
    promptSnippet:
      "Find task-relevant code and context in the current workspace via Ripwire",
    parameters: Type.Object({
      task: Type.String({
        minLength: 1,
        description: "Change or question to investigate",
      }),
      tokenBudget: Type.Optional(
        Type.Integer({
          minimum: 1000,
          maximum: 16000,
          description: "Ripwire output budget in tokens (default 4000)",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await pi.exec(
        "ripwire",
        [
          ctx.cwd,
          `--for=${params.task}`,
          `--token-budget=${params.tokenBudget ?? 4000}`,
          "--legend=compact",
        ],
        { cwd: ctx.cwd, signal, timeout: 120_000 },
      );

      if (result.code !== 0 || result.killed) {
        const reason = result.killed
          ? "timed out or cancelled"
          : `exited with code ${result.code}`;
        const diagnostic = truncateHead(result.stderr || result.stdout, {
          maxLines: 30,
          maxBytes: 2000,
        }).content;
        throw new Error(
          `ripwire ${reason}. Ensure ripwire is installed and on PATH. ${diagnostic}`,
        );
      }

      const output = truncateHead(result.stdout, {
        maxLines: DEFAULT_MAX_LINES,
        maxBytes: DEFAULT_MAX_BYTES,
      });
      return {
        content: [
          {
            type: "text",
            text: output.truncated
              ? `${output.content}\n[Output truncated at 2000 lines / 50KB; narrow the task or lower tokenBudget.]`
              : output.content,
          },
        ],
        details: { truncated: output.truncated },
      };
    },
  });
}
