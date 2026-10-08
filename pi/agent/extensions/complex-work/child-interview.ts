/** Headless agents call interview here; the owning interactive Pi session presents the real form. */
import { randomUUID } from "node:crypto";
import { existsSync, watch } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { captureInterviewTool, INTERVIEW_BINDING, readTransport, transportFile, writeTransport,
  type InterviewBinding, type InterviewRequest, type InterviewResponse, type InterviewResult } from "./interview-protocol.ts";

function bindingFromEnvironment(): InterviewBinding {
  let bindings: Record<string, InterviewBinding>;
  try { bindings = JSON.parse(process.env.PI_SUBAGENT_EXTENSION_BINDINGS ?? "{}"); }
  catch { throw new Error("Invalid interview extension binding."); }
  const binding = bindings[INTERVIEW_BINDING];
  if (!binding?.directory || !binding.taskId || !binding.stageRunId || !binding.ownerSessionId) {
    throw new Error("Interview bridge missing. Pass the mission's interview extensionBindings unchanged to this delegate.");
  }
  return binding;
}

function awaitInterview(request: InterviewRequest, signal?: AbortSignal): Promise<InterviewResult> {
  const { directory } = request.binding;
  const responseFile = transportFile(directory, request.id, "response");
  const requestFile = transportFile(directory, request.id, "request");
  const cancelFile = transportFile(directory, request.id, "cancel");
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, response?: InterviewResponse) => {
      if (settled) return;
      settled = true;
      watcher.close();
      clearTimeout(deadline);
      signal?.removeEventListener("abort", abort);
      if (error) return reject(error);
      if (response?.error) return reject(new Error(response.error));
      if (!response?.result) return reject(new Error("Interview response contained no result."));
      resolve(response.result);
    };
    const inspect = () => {
      if (existsSync(join(directory, "closed.json"))) return finish(new Error("Interview scope closed by a user navigation order."));
      if (!existsSync(responseFile)) return;
      try { finish(undefined, readTransport<InterviewResponse>(responseFile)); }
      catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
    };
    const cancel = (reason: Error) => {
      try { writeTransport(cancelFile, { cancelledAt: new Date().toISOString(), reason: reason.message }); }
      catch (error) { return finish(new Error(`${reason.message} Cancellation record failed: ${String(error)}`)); }
      finish(reason);
    };
    const abort = () => cancel(new Error("Interview aborted. Preserve unresolved questions in your report."));
    const watcher = watch(directory, inspect);
    const seconds = typeof request.params.timeout === "number" ? request.params.timeout : 600;
    const waitMs = Math.min(3_600_000, Math.max(30_000, seconds * 1000 + 300_000));
    const deadline = setTimeout(() => cancel(new Error("Interview bridge deadline reached (including queue time). Report blockers; do not guess.")), waitMs);
    watcher.on("error", error => finish(error));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) return abort();
    try {
      if (existsSync(join(directory, "closed.json"))) return finish(new Error("Interview scope is closed."));
      writeTransport(requestFile, request);
      inspect();
    }
    catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  });
}

export default function childInterview(pi: ExtensionAPI): void {
  const provider = captureInterviewTool(pi);
  pi.registerTool({
    ...provider,
    description: `${provider.description} In this background agent, the main Pi session opens the form. Use async:false and wait. Answers clarify work; they never approve a workflow transition.`,
    async execute(_id, params, signal, _onUpdate, ctx) {
      const binding = bindingFromEnvironment();
      if (!params || typeof params !== "object") throw new Error("Interview parameters must be an object.");
      const request: InterviewRequest = { version: 1, id: randomUUID(), binding,
        childSessionId: ctx.sessionManager.getSessionId(), cwd: ctx.cwd, params: { ...params, async: false } };
      return awaitInterview(request, signal);
    },
  });
}
