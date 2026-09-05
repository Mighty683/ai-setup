// Thin adapter to the installed pi-subagents public async launch API.
import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type SpawnResult = { details?: { runId?: string; asyncId?: string } };
type Reply = { success?: boolean; data?: SpawnResult; error?: { message?: string } };

/** Launch once; an acknowledgement timeout never retries a potentially running child. */
export function spawnSubagent(pi: ExtensionAPI, params: Record<string, unknown>, timeoutMs = 30_000): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    let unsubscribe: (() => void) | undefined;
    const timer = setTimeout(() => {
      unsubscribe?.();
      reject(new Error("Subagent launch acknowledgement timed out. Check /subagents before retrying; the agent may already be running."));
    }, timeoutMs);
    unsubscribe = pi.events.on(`subagents:rpc:v1:reply:${requestId}`, raw => {
      clearTimeout(timer);
      unsubscribe?.();
      const reply = raw as Reply | undefined;
      if (reply?.success) resolve(reply.data ?? {});
      else reject(new Error(reply?.error?.message ?? "Subagent launch failed. Check that pi-subagents is installed and ready."));
    });
    try {
      pi.events.emit("subagents:rpc:v1:request", { version: 1, requestId, method: "spawn", params, source: { extension: "complex-work" } });
    } catch (error) {
      clearTimeout(timer);
      unsubscribe();
      reject(error);
    }
  });
}
