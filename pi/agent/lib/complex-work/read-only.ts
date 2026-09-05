// Research/plan mode allows delegation while keeping descendants read-only.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSubagentCapabilityCeiling } from "pi-subagents/capability-ceiling";

const TOOLS = ["read", "grep", "find", "ls", "web_search", "fetch_content", "get_search_content", "subagent"];

/** Loaded only by research and planning agents; parent implementation tools stay available. */
export default function readOnlyMode(pi: ExtensionAPI): void {
  let ceiling: ReturnType<typeof registerSubagentCapabilityCeiling> | undefined;
  pi.on("session_start", (_event, ctx) => {
    ceiling?.dispose();
    ceiling = registerSubagentCapabilityCeiling({
      sessionId: ctx.sessionManager.getSessionId(),
      source: "complex-work-read-only",
      ceiling: { allowedTools: TOOLS },
    });
  });
  pi.on("tool_call", event => {
    if (!TOOLS.includes(event.toolName)) return { block: true, reason: "Research and plan mode are read-only. Return findings or a plan for user review." };
  });
  pi.on("session_shutdown", () => { ceiling?.dispose(); });
}
