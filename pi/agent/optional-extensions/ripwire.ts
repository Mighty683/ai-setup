import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { spawn } from "node:child_process";

const ripwireCommand =
  process.env.RIPWIRE_BIN ?? `${process.env.HOME}/.local/bin/ripwire`;

function runRipwire(args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ripwireCommand, [".", ...args], {
      cwd: process.cwd(),
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
        resolve(stdout || stderr || "OK");
        return;
      }

      reject(
        new Error(`ripwire exited with ${code}\n${stdout}${stderr}`.trim()),
      );
    });
  });
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "ripwire",
    label: "Ripwire",
    description:
      'Query a ranked local codebase map. Pass Ripwire CLI flags without the repository path; for example, ["--for=add authentication"] or ["--callers=authenticate"].',
    parameters: Type.Object({
      args: Type.Array(Type.String(), {
        description:
          "Ripwire CLI flags. The current project is supplied automatically; do not include a repository path.",
      }),
    }),
    async execute(_id, params, signal) {
      try {
        const text = await runRipwire(params.args, signal);
        return {
          content: [{ type: "text", text }],
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
