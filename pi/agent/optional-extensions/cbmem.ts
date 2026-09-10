import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { spawn } from "node:child_process";

function callCbm(
  tool: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const command = `${process.env.HOME}/.local/bin/codebase-memory-mcp`;

    const argv = ["cli", tool, JSON.stringify(args)];

    const child = spawn(command, argv, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    signal?.addEventListener("abort", () => {
      child.kill("SIGTERM");
    });

    child.on("error", reject);

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`codebase-memory-mcp exited with ${code}\n${stderr}`));
      }
    });
  });
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "cbmem",
    label: "Codebase Memory",
    description:
      "Query Codebase Memory. Supports tools such as list_projects, index_repository, search_graph, trace_path and query_graph.",

    parameters: Type.Object({
      tool: Type.String({
        description:
          "Codebase Memory CLI tool, e.g. list_projects, search_graph, trace_path, query_graph",
      }),

      args: Type.Optional(
        Type.Record(Type.String(), Type.Unknown(), {
          description: "Arguments passed to the Codebase Memory tool",
        }),
      ),
    }),

    async execute(_id, params, signal) {
      try {
        const text = await callCbm(params.tool, params.args ?? {}, signal);

        return {
          content: [
            {
              type: "text",
              text: text || "OK",
            },
          ],
          details: {},
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: error instanceof Error ? error.message : String(error),
            },
          ],
          details: {},
        };
      }
    },
  });
}
