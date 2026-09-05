// Pi adapter: the main LLM defines work; user commands grant scope and delivery authority.
import path from "node:path";
import os from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { ComplexWorkEngine } from "../lib/complex-work/engine.ts";
import { createRpc } from "../lib/complex-work/rpc.ts";
import { registerAssignment } from "../lib/complex-work/roles.ts";
import { planSchema, researchBriefSchema, workBatchSchema, deliverySchema } from "../lib/complex-work-contracts.ts";
import { acquireMissionLease, createMission, loadMission, pointers, saveMission } from "../lib/complex-work/store.ts";
import { active, approved, isAgent, terminal, writable, type Mission } from "../lib/complex-work/state.ts";

const WORKFLOW_GUIDANCE = readFileSync(fileURLToPath(new URL("../prompts/complex-work.md", import.meta.url)), "utf8");

export function formatComplexWorkStatus(state: Mission): string {
  return [
    `Complex work: ${state.request}`, `Status: ${state.status}${state.paused ? " (scheduling paused)" : ""}`,
    `Scope revision: ${state.revision}; approved: ${approved(state) ? state.revision : "none"}`,
    `Agent launches: ${state.launches}/${state.policy.maxLaunches}; concurrency: ${state.policy.maxAgents} agents, ${state.policy.maxChecks} local operations`,
    ...Object.values(state.work).map(job => `- ${job.id}: ${job.status} (${"assignment" in job ? job.assignment.name : job.kind}); depends on: ${job.dependsOn.join(", ") || "none"}${job.error ? ` — ${job.error}` : ""}`),
    ...state.decisions.map((q, i) => `Decision ${i + 1}: ${q}`),
    ...(state.delivery ? [`Delivery: ${state.delivery.status}; head ${state.delivery.head}${state.delivery.error ? ` — ${state.delivery.error}` : ""}`] : []),
    ...(state.legacy ? ["Legacy workflow retained with scheduling paused. Cancel it before starting a new mission; evidence is preserved."] : []),
    `Private repository: ${state.workspace.repo}`, `State and evidence: ${state.stateFile}`,
    "Recent history:", ...state.history.slice(-12).map(item => `${item.at}: ${item.message}`),
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
  let starting = false; let reconciling = false;
  let releaseLease: (() => Promise<void>) | undefined;
  let recoveryError: string | undefined;
  const registrations = new Map<string, { name: string; dispose(): void }>();
  const disposeAssignments = () => { for (const item of registrations.values()) item.dispose(); registrations.clear(); };
  const rpc = createRpc(pi);
  const notice = (message: string, attention: boolean) => {
    if (attention && process.env.PI_SOUND_DISABLED !== "1") process.stdout.write("\x07");
    pi.sendMessage({ customType: "complex-work", content: message, display: true }, { triggerTurn: attention, deliverAs: "followUp" });
  };
  const current = () => { if (!engine) throw new Error("Start a complex-work mission first"); return engine; };
  const response = () => ({ content: [{ type: "text" as const, text: formatComplexWorkStatus(current().state) }], details: {} });
  const attach = async (state: Mission) => {
    engine?.dispose(); disposeAssignments();
    await releaseLease?.(); releaseLease = undefined;
    releaseLease = await acquireMissionLease(state);
    engine = new ComplexWorkEngine(state, {
      rpc, notice,
      register: (job, assignment) => {
        let item = registrations.get(job.id);
        if (!item) {
          item = registerAssignment(pi, job.operationId, assignment, writable(job));
          registrations.set(job.id, item);
        }
        return item.name;
      },
      save: async state => {
        pi.appendEntry("complex-work-state", await saveMission(state));
        for (const [id, item] of registrations) if (!active(state.work[id])) { item.dispose(); registrations.delete(id); }
      },
    });
  };
  pi.registerTool({
    name: "complex_work_control", label: "Work ledger",
    description: "Inspect scope, authority, dependencies and work status. Supply a work id to read its complete assignment and results. No id returns a summary; nothing is approved or launched.",
    promptGuidelines: [WORKFLOW_GUIDANCE],
    parameters: Type.Object({ id: Type.Optional(Type.String()) }, { additionalProperties: false }),
    execute: async (_id, params): Promise<{ content: { type: "text"; text: string }[]; details: Record<string, unknown> }> => {
      const state = current().state;
      if (params.id) {
        const work = state.work[params.id]; if (!work) throw new Error("Unknown work id");
        return { content: [{ type: "text", text: JSON.stringify(work, null, 2) }], details: { work } };
      }
      return { content: [{ type: "text", text: formatComplexWorkStatus(state) }], details: {
        plan: state.plan, brief: state.brief, answers: state.answers, steering: state.steering, integrations: state.integrations, delivery: state.delivery,
      } };
    },
  });
  pi.registerTool({
    name: "complex_work_submit", label: "Queue work",
    description: "Append model-defined operations and dependencies to the durable ledger. Agent operations define their own name, instructions, model and read/write access. A write needs an approved scope taskId. Checks use the task's approved commands, or finalChecks if taskId is absent. Reviews inspect an input's exact candidate revision. Integration references matching passing check/review work ids and its candidate input. Every input/evidence id must be a direct dependency. Work can be queued before scope approval; protected operations wait. Use allowFailed only to deliberately recover from a failed dependency. Work completion creates no additional operations.",
    parameters: Type.Object({ work: workBatchSchema }, { additionalProperties: false }),
    execute: async (_id, params) => { await current().submitWork(params.work); return response(); },
  });
  pi.registerTool({
    name: "complex_work_scope", label: "Propose scope",
    description: "Propose authority boundaries: objective, non-goals, acceptance criteria, task resource claims and approved argv checks including dependency setup where needed, plus final checks. This defines no workflow or agent roster. Requires no active operations; supersedes pending work and invalidates approval. The user approves the new revision. Use the private snapshot and evidence; private checkouts omit ignored dependencies. Preserve user decisions.",
    parameters: Type.Object({ brief: researchBriefSchema, plan: planSchema }, { additionalProperties: false }),
    execute: async (_id, params) => { await current().submitScope(params.brief, params.plan); return response(); },
  });
  pi.registerTool({
    name: "complex_work_cancel_work", label: "Cancel work items",
    description: "Cancel unnecessary pending work or request stop of running assignments. Cancellation preserves evidence and does not expand scope. Dependents remain pending until explicitly cancelled or replaced; uncertain runs retain their slots until termination is confirmed.",
    parameters: Type.Object({ ids: Type.Array(Type.String(), { minItems: 1 }) }, { additionalProperties: false }),
    execute: async (_id, params) => { await current().cancelWork(params.ids); return response(); },
  });
  pi.registerTool({
    name: "complex_work_delivery", label: "Request delivery approval",
    description: "Present completed work for user delivery approval. Requires all scope tasks integrated and matching passing final checks and independent review evidence for the current integration head; no outstanding work may remain. This never applies the patch.",
    parameters: deliverySchema,
    execute: async (_id, params) => { await current().requestDelivery(params); return response(); },
  });
  pi.registerTool({
    name: "complex_work_decision", label: "Request scope decision",
    description: "Record genuinely unresolved user scope/product decisions. Scheduling pauses until user answers. Routine failures and agent assignment choices are yours to resolve within approved scope.",
    parameters: Type.Object({ questions: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }) }, { additionalProperties: false }),
    execute: async (_id, params) => { await current().askDecision(params.questions); return response(); },
  });
  pi.registerTool({
    name: "complex_work_withdraw_delivery", label: "Withdraw delivery request",
    description: "Release a pending or failed delivery reservation so you can schedule corrections. Cannot interrupt an approved delivery already running.",
    parameters: Type.Object({}, { additionalProperties: false }),
    execute: async () => { await current().userAction("withdraw-delivery"); return response(); },
  });
  pi.on("tool_call", event => {
    if (engine && !terminal(engine.state) && ["subagent", "bash", "edit", "write"].includes(event.toolName)) return {
      block: true, reason: "Use the work ledger for delegated work and mutations. Read/search tools remain available for coordination.",
    };
  });
  pi.on("session_start", async (_event, ctx) => {
    engine?.dispose(); engine = undefined; disposeAssignments();
    await releaseLease?.(); releaseLease = undefined; recoveryError = undefined;
    const sessionFile = ctx.sessionManager.getSessionFile(); if (!sessionFile) return;
    const pointer = pointers(ctx.sessionManager.getBranch()).at(-1); if (!pointer) return;
    try {
      const state = await loadMission(pointer, sessionFile); if (!state) return;
      await attach(state);
      for (const job of Object.values(state.work).filter(active)) if ("assignment" in job) {
        registrations.set(job.id, registerAssignment(pi, job.operationId, job.assignment, writable(job)));
      }
      await engine!.reconcile(); await engine!.transaction(() => {});
      if (state.legacy) ctx.ui.notify("Previous workflow preserved and paused. Cancel it before starting a new mission.", "warning");
    } catch (error) { recoveryError = String(error); ctx.ui.notify(`Work recovery failed: ${recoveryError}`, "error"); }
  });
  pi.events.on("subagent:async-complete", payload => { void engine?.onCompletion(payload).catch(error => notice(String(error), true)); });
  const timer = setInterval(() => {
    if (!engine || reconciling) return;
    reconciling = true; void engine.reconcile().catch(error => notice(String(error), false)).finally(() => { reconciling = false; });
  }, 15_000);
  timer.unref();
  pi.on("session_shutdown", async () => { clearInterval(timer); engine?.dispose(); disposeAssignments(); await releaseLease?.(); releaseLease = undefined; });
  pi.registerCommand("complex-work", {
    description: "Create a private snapshot and let the coordinating model define work",
    handler: async (args, ctx) => {
      if (!args.trim()) { ctx.ui.notify("Usage: /complex-work <request>", "warning"); return; }
      if (starting || recoveryError || (engine && (!terminal(engine.state) || Object.values(engine.state.work).some(active) || Object.keys(engine.state.legacy?.data.jobs ?? {}).length))) {
        ctx.ui.notify("An existing mission or unresolved operation must finish or be cancelled first.", "error"); return;
      }
      const file = ctx.sessionManager.getSessionFile(); if (!file) { ctx.ui.notify("A persisted session is required.", "error"); return; }
      starting = true;
      try {
        const root = path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "pi", "complex-work");
        const state = await createMission(ctx.cwd, file, args.trim(), root);
        await attach(state); pi.setSessionName(`Complex work: ${args.trim().slice(0, 72)}`);
        await engine!.start();
      } catch (error) { ctx.ui.notify(String(error), "error"); }
      finally { starting = false; }
    },
  });
  const commands: Record<string, string> = {
    go: "Approve current scope: <revision>", pause: "Pause scheduling", resume: "Resume queued work",
    policy: "Change idle operating limits: <JSON>", decide: "Answer pending questions: <JSON array>",
    "approve-task": "Approve a pending integration: <work-id>", verify: "Approve requested delivery: <revision>",
    retry: "Ask the coordinating model to reassess failed work: [work-id]", replan: "Ask the model to reconsider scope/work: [guidance]",
    steer: "Give guidance within current authority: <message>", cancel: "Cancel the mission and preserve evidence",
    "withdraw-delivery": "Withdraw a pending delivery request",
  };
  for (const [action, description] of Object.entries(commands)) pi.registerCommand(`complex-work-${action}`, {
    description, handler: async (args, ctx) => {
      try {
        const e = current();
        if (action === "cancel") await e.cancel();
        else if (action === "steer") await e.steer(args.trim());
        else if (action === "retry" || action === "replan") await e.steer(`User requests ${action}: ${args.trim()}. Inspect evidence and choose next work; do not replay a fixed sequence.`);
        else await e.userAction(action, args.trim());
        ctx.ui.notify(formatComplexWorkStatus(e.state), "info");
      } catch (error) { ctx.ui.notify(String(error), "error"); }
    },
  });
  pi.registerCommand("complex-work-status", {
    description: "Inspect work, dependencies, authority and evidence",
    handler: async (_args, ctx) => {
      if (!engine) { ctx.ui.notify("No mission in this session.", "info"); return; }
      const text = formatComplexWorkStatus(engine.state);
      if (ctx.mode !== "tui") { ctx.ui.notify(text, "info"); return; }
      await ctx.ui.custom<void>((tui, _theme, _keys, done) => new StatusPopup(text, () => done(), () => tui.requestRender()),
        { overlay: true, overlayOptions: { width: "80%", minWidth: 40, maxHeight: "80%", anchor: "center", margin: 1 } });
    },
  });
}
