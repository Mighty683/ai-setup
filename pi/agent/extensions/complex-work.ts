// Pi UI adapter for the durable task-graph controller. User commands own approvals; agents own bounded work.
import path from "node:path";
import os from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { ComplexWorkEngine } from "../lib/complex-work/engine.ts";
import { createRpc } from "../lib/complex-work/rpc.ts";
import { registerRoles } from "../lib/complex-work/roles.ts";
import { acquireMissionLease, createMission, loadMission, pointers, saveMission, STATE_ENTRY } from "../lib/complex-work/store.ts";
import { terminal, type Mission } from "../lib/complex-work/state.ts";

const CONTROL_TOOL = "complex_work_control";
export function formatComplexWorkStatus(state: Mission): string {
  const tasks = Object.entries(state.tasks);
  return [
    `Complex work: ${state.request}`, `Phase: ${state.phase}${state.paused ? " (scheduling paused)" : ""}`,
    `Plan revision: ${state.revision}; approved: ${state.approval?.revision ?? "none"}`,
    `Tasks: ${tasks.filter(([, task]) => task.stage === "done").length}/${tasks.length} complete; active operations: ${Object.keys(state.jobs).length}`,
    `Agent launches: ${state.launches}/${state.policy.maxLaunches}; limits: ${state.policy.maxAgents} agents, ${state.policy.maxChecks} checks`,
    `Checkpoints: ${state.policy.checkpoints}; automatic repairs: ${state.policy.maxRepairs}/task`,
    ...tasks.map(([id, task]) => `- ${id}: ${task.stage}${task.error ? ` — ${task.error.slice(0, 240)}` : ""}`),
    ...Object.values(state.jobs).filter(job => job.status === "uncertain").map(job => `- Uncertain ${job.id}: ${job.error ?? job.kind}`),
    ...state.errors.map(error => `Attention: ${error}`),
    `Review checkout: ${state.workspace.repo}`, `Evidence: ${state.workspace.root}`, `State: ${state.stateFile}`,
    "Recent history:", ...state.history.slice(-20).map(item => `${item.at}: ${item.message}`),
  ].join("\n");
}
class StatusPopup {
  private offset = 0;
  private text: string;
  private done: () => void;
  private renderAgain: () => void;
  constructor(text: string, done: () => void, renderAgain: () => void) {
    this.text = text; this.done = done; this.renderAgain = renderAgain;
  }
  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter) || data === "q") this.done();
    if (matchesKey(data, Key.up)) this.offset = Math.max(0, this.offset - 1);
    if (matchesKey(data, Key.down)) this.offset = Math.min(Math.max(0, this.text.split("\n").length - 14), this.offset + 1);
    this.renderAgain();
  }
  render(width: number): string[] {
    return ["Complex Work — ↑↓ scroll, Enter/Esc close", ...this.text.split("\n").slice(this.offset, this.offset + 14)].map(line => truncateToWidth(line, width));
  }
  invalidate(): void {}
}
export default function complexWorkExtension(pi: ExtensionAPI): void {
  let engine: ComplexWorkEngine | undefined;
  let disposeRoles: (() => void) | undefined;
  let starting = false;
  let reconciling = false;
  let legacyRun: string | undefined;
  let releaseLease: (() => Promise<void>) | undefined;
  let recoveryError: string | undefined;
  const rpc = createRpc(pi);
  const notice = (message: string, attention: boolean) => {
    if (attention && process.env.PI_SOUND_DISABLED !== "1") process.stdout.write("\x07");
    pi.sendMessage({ customType: "complex-work", content: message, display: true }, { triggerTurn: attention, deliverAs: "followUp" });
  };
  const ensureRoles = () => { if (!disposeRoles) disposeRoles = registerRoles(pi); };
  const attach = async (state: Mission) => {
    engine?.dispose();
    await releaseLease?.(); releaseLease = undefined;
    releaseLease = await acquireMissionLease(state);
    engine = new ComplexWorkEngine(state, {
      rpc, notice, save: async current => { pi.appendEntry(STATE_ENTRY, await saveMission(current)); },
    });
  };
  pi.registerTool({
    name: CONTROL_TOOL, label: "Complex work status",
    description: "Inspect the current workflow and its evidence. Approvals, decisions and lifecycle changes are user commands.",
    promptGuidelines: ["Complex-work owns delegation and scheduling. Present its plans, evidence and genuine decision gates concisely. The user approves a displayed revision with /complex-work-go and delivery with /complex-work-verify. Never impersonate user commands or run a second workflow."],
    parameters: Type.Object({ action: Type.Literal("status") }, { additionalProperties: false }),
    execute: async () => ({ content: [{ type: "text", text: engine ? formatComplexWorkStatus(engine.state) : "No active complex-work mission." }], details: { state: engine?.state ?? null } }),
  });
  pi.on("tool_call", event => {
    if (!engine || terminal(engine.state)) return;
    if (["subagent", "bash", "edit", "write"].includes(event.toolName)) return {
      block: true, reason: "The active complex-work controller owns delegation and mutation. Inspect status or use the user controls to steer, pause, or cancel.",
    };
  });
  pi.on("session_start", async (_event, ctx) => {
    engine?.dispose(); engine = undefined; legacyRun = undefined;
    await releaseLease?.(); releaseLease = undefined; recoveryError = undefined;
    const sessionFile = ctx.sessionManager.getSessionFile();
    if (!sessionFile) return;
    const entries = ctx.sessionManager.getBranch();
    const pointer = pointers(entries).at(-1);
    const last: any = entries.filter((entry: any) => entry.type === "custom" && entry.customType === STATE_ENTRY).at(-1);
    if (last?.data?.version !== 2 && last?.data?.phase !== "inactive") legacyRun = last?.data?.activeRun?.runId;
    if (!pointer) {
      if (legacyRun) ctx.ui.notify("A legacy complex-work run was retained. /complex-work-cancel stops it before starting the new controller.", "warning");
      return;
    }
    try {
      const state = await loadMission(pointer, sessionFile);
      if (!state) return;
      ensureRoles(); await attach(state);
      await engine!.reconcile();
      await engine!.transaction(() => {});
    } catch (error) { recoveryError = String(error); ctx.ui.notify(`Complex-work recovery failed: ${recoveryError}`, "error"); }
  });
  pi.events.on("subagent:async-complete", payload => { void engine?.onCompletion(payload).catch(error => notice(String(error), true)); });
  const timer = setInterval(() => {
    if (!engine || reconciling) return;
    reconciling = true;
    void engine.reconcile().catch(error => notice(String(error), false)).finally(() => { reconciling = false; });
  }, 15_000);
  timer.unref();
  pi.on("session_shutdown", async () => { clearInterval(timer); engine?.dispose(); disposeRoles?.(); disposeRoles = undefined; await releaseLease?.(); releaseLease = undefined; });
  pi.registerCommand("complex-work", {
    description: "Research and plan a task graph, then request approval of one revision",
    handler: async (args, ctx) => {
      if (!args.trim()) { ctx.ui.notify("Usage: /complex-work <request>", "warning"); return; }
      if (starting || legacyRun || recoveryError || (engine && (!terminal(engine.state) || Object.keys(engine.state.jobs).length))) {
        ctx.ui.notify("An existing mission or unresolved operation must finish or be cancelled first.", "error"); return;
      }
      const sessionFile = ctx.sessionManager.getSessionFile();
      if (!sessionFile) { ctx.ui.notify("Complex work requires a persisted session.", "error"); return; }
      starting = true;
      try {
        ensureRoles();
        const stateRoot = process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
        const state = await createMission(ctx.cwd, sessionFile, args.trim(), path.join(stateRoot, "pi", "complex-work"));
        await attach(state); pi.setSessionName(`Complex work: ${args.trim().slice(0, 72)}`);
        await engine!.start(); ctx.ui.notify("Research started in a private snapshot. The plan will be presented for approval.", "info");
      } catch (error) { ctx.ui.notify(String(error), "error"); }
      finally { starting = false; }
    },
  });
  const commands: Record<string, string> = {
    go: "Approve the displayed plan revision: <revision>", pause: "Stop scheduling; let current work finish", resume: "Resume approved work",
    policy: "Set operating policy: <JSON object>", decide: "Answer research decisions: <JSON array in displayed order>",
    "approve-task": "Approve a reviewed task checkpoint: <task-id>", verify: "Apply the final reviewed result: <revision>",
    retry: "Renew the retry budget for an idle blocked task: [task-id]", replan: "Create a replacement plan: [decision or change]",
    steer: "Deliver guidance without changing approved scope: <message>", cancel: "Stop the mission and preserve its artifacts",
  };
  for (const [action, description] of Object.entries(commands)) {
    pi.registerCommand(`complex-work-${action}`, { description, handler: async (args, ctx) => {
      try {
        if (legacyRun && action === "cancel") { await rpc("stop", { id: legacyRun }); legacyRun = undefined; ctx.ui.notify("Legacy run stopped.", "info"); return; }
        if (!engine) throw new Error("No complex-work mission in this session");
        if (action === "cancel") await engine.cancel();
        else if (action === "steer") await engine.steer(args.trim());
        else await engine.userAction(action, args.trim());
        ctx.ui.notify(formatComplexWorkStatus(engine.state), "info");
      } catch (error) { ctx.ui.notify(String(error), "error"); }
    } });
  }
  pi.registerCommand("complex-work-status", { description: "Show task progress, gates, evidence and recent history", handler: async (_args, ctx) => {
    if (!engine) { ctx.ui.notify("No complex-work mission in this session.", "info"); return; }
    const text = formatComplexWorkStatus(engine.state);
    if (ctx.mode !== "tui") { ctx.ui.notify(text, "info"); return; }
    await ctx.ui.custom<void>((tui, _theme, _keys, done) => new StatusPopup(text, () => done(), () => tui.requestRender()),
      { overlay: true, overlayOptions: { width: "80%", minWidth: 40, maxHeight: "80%", anchor: "center", margin: 1 } });
  } });
}
