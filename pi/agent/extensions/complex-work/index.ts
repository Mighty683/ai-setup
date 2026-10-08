/** Sole workflow entry point. XState owns UI screens; the controller owns durable, explicitly approved SDLC actions. */
import { existsSync, lstatSync, mkdirSync, realpathSync, rmdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { MissionController, activeRun } from "./controller.ts";
import { SubagentRunner } from "./runner.ts";
import { STAGES, type Action, type Stage, type TaskRecord } from "./state.ts";
import { InterviewBroker } from "./interview-broker.ts";
import { planningModels } from "./models.ts";
import { MissionWorkspace, type MissionView } from "./workspace.ts";
import { WorkspaceObserver, WorkspaceOutput } from "./output.ts";
import { createWorkspaceActor, selectedMission, workspaceView, type UiOrderResult } from "./ui-machine.ts";
import { missionSummary } from "./dashboard.ts";
import type { MergeApproval } from "./worktrees.ts";

const ACTIONS = new Set<Action>(["next", "back", "retry", "end", "pause", "resume", "cancel", "reopen", "merge"]);
const SELECTION = "complex-work-selection";
function targetStage(value: string | undefined): Stage {
  if (!value || !STAGES.includes(value as Stage) || value === "end") throw new Error("Select an available work stage.");
  return value as Stage;
}
function projectRoot(cwd: string): string {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", timeout: 2_000 });
  return realpathSync(result.status === 0 && result.stdout.trim() ? result.stdout.trim() : cwd);
}
/** Cross-process orders stay serialized. Crashed locks require inspection, never automatic expiry. */
async function withCommandLock<T>(root: string, work: () => Promise<T>): Promise<T> {
  const tasks = join(root, "docs", "tasks");
  for (const folder of [join(root, "docs"), tasks]) {
    if (existsSync(folder) && lstatSync(folder).isSymbolicLink()) throw new Error(`Refusing symlink: ${folder}`);
    mkdirSync(folder, { recursive: true });
  }
  const lock = join(tasks, ".controller-lock");
  try { mkdirSync(lock); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Command post busy. Inspect an interrupted controller lock before retrying.");
    throw error;
  }
  try { return await work(); }
  finally { rmdirSync(lock); }
}

export default function complexWork(pi: ExtensionAPI): void {
  const runner = new SubagentRunner(pi);
  const output = new WorkspaceOutput();
  const observer = new WorkspaceObserver();
  let context: ExtensionContext | undefined;
  let commandContext: ExtensionCommandContext | undefined;
  let workspace: MissionWorkspace | undefined;
  let commandBusy = false;
  let reconciling = false;
  let reconciliationPending = false;
  const pendingCompletions = new Set<string>();
  const interviews = new InterviewBroker(pi, message => { if (context) report(message, context, true); });
  const ui = createWorkspaceActor({ execute: runOrder, persistSelection });

  function clearPiBanner(ctx: ExtensionContext): void {
    ctx.ui.setStatus("complex-work", undefined);
    ctx.ui.setWidget("complex-work", undefined);
  }
  function report(text: string, ctx: ExtensionContext, error = false): void {
    if (ctx.hasUI) ctx.ui.notify(text, error ? "error" : "info");
    else pi.sendMessage({ customType: "complex-work", content: text, display: true }, { triggerTurn: false });
  }
  function controller(ctx: ExtensionContext): MissionController {
    const root = projectRoot(ctx.cwd);
    interviews.attach(root, ctx, refreshWorkspace);
    return new MissionController(root, runner, ctx.sessionManager.getSessionId(), {
      prepareInterview: (task, run) => interviews.prepare(task, run),
      cancelInterview: (task, run) => interviews.cancelRun(task, run),
      planningModels: () => planningModels(ctx, root),
    });
  }
  function persistSelection(taskId?: string): void {
    if (!context) return;
    pi.appendEntry(SELECTION, { root: projectRoot(context.cwd), taskId });
  }
  function restoreSelection(ctx: ExtensionContext, root: string): void {
    let taskId: string | undefined;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== SELECTION) continue;
      const data = entry.data as { root?: string; taskId?: string };
      if (data?.root === root) taskId = data.taskId;
    }
    ui.send({ type: "RESTORE", taskId });
  }
  function refreshWorkspace(): void {
    if (!context) return;
    try {
      const mission = controller(context);
      const tasks = mission.store.list();
      const merge: Record<string, MergeApproval> = {};
      const mergeBlockers: Record<string, string> = {};
      for (const task of tasks.filter(item => item.state.currentState === "merge" && item.state.executionStatus === "awaiting-user")) {
        try { merge[task.state.taskId] = mission.mergeApproval(task.state.taskId); }
        catch (error) { mergeBlockers[task.state.taskId] = String(error); }
      }
      ui.send({ type: "DATA", data: {
        identity: `${mission.root}/${mission.sessionId}`,
        tasks, pendingTitles: mission.bootstraps().filter(item => item.status === "running" || item.status === "dispatching").map(item => item.error ?? "Preparing a title…"),
        workflow: Object.fromEntries(tasks.map(item => [item.state.taskId, output.workflow(item)])),
        interviewSummary: interviews.summary() ?? "", merge, mergeBlockers,
      } });
    } catch (error) { report(`Workspace refresh blocked: ${String(error)}`, context, true); }
  }
  function view(): MissionView {
    const snapshot = ui.getSnapshot();
    const result = workspaceView(snapshot);
    const task = selectedMission(snapshot.context);
    if (snapshot.hasTag("mission-output") && task) {
      result.output = output.output(task, snapshot.context.outputSelection);
      const mergeBlocker = snapshot.context.data.mergeBlockers?.[task.state.taskId];
      if (mergeBlocker && result.output.key === `${task.state.taskId}/merge`) result.output.content += `\n\n**Merge blocked:** ${mergeBlocker}\n\nRepair in normal Pi, then select Refresh status.`;
    }
    if (workspace && context) observer.sync(task && snapshot.hasTag("mission-output") ? output.directories(task) : [join(projectRoot(context.cwd), "docs", "tasks")], refreshWorkspace);
    return result;
  }
  function select(task: TaskRecord, root: string, ctx: ExtensionContext): void {
    if (!context || projectRoot(context.cwd) !== root || context.sessionManager.getSessionId() !== ctx.sessionManager.getSessionId()) return;
    refreshWorkspace();
    ui.send({ type: "SELECT", taskId: task.state.taskId });
  }
  function flushCompletionMetadata(mission: MissionController): void {
    for (const runId of pendingCompletions) { mission.recordCompletionMetadata(runId); pendingCompletions.delete(runId); }
  }

  async function reconcile(ctx: ExtensionContext): Promise<void> {
    if (reconciling || commandBusy) { reconciliationPending = true; return; }
    reconciling = true;
    reconciliationPending = false;
    try {
      const root = projectRoot(ctx.cwd);
      if (!existsSync(join(root, "docs", "tasks"))) return;
      const mission = controller(ctx);
      const hasWork = pendingCompletions.size > 0 || mission.store.list().some(task => activeRun(task))
        || mission.bootstraps().some(item => item.sessionId === mission.sessionId && item.status === "running");
      if (!hasWork) return;
      await withCommandLock(mission.root, async () => {
        flushCompletionMetadata(mission);
        const created = await mission.reconcileBootstraps();
        for (const task of created) {
          select(task, mission.root, ctx);
          report(`${task.state.title} · Gathering requirements…`, ctx);
          await mission.launch(task.state.taskId);
        }
        for (const task of mission.store.list()) {
          if (!activeRun(task)) continue;
          const updated = await mission.reconcile(task.state.taskId);
          if (updated.state.executionStatus !== "running") report(`${updated.state.title}\n${missionSummary(updated)}`, ctx);
        }
      });
    } catch (error) { report(`Mission reconciliation blocked: ${String(error)}`, ctx, true); }
    finally {
      reconciling = false;
      interviews.refresh();
      refreshWorkspace();
      if (reconciliationPending && context) void reconcile(context);
    }
  }

  async function runOrder(key: string, input: string): Promise<UiOrderResult> {
    const ctx = commandContext;
    if (!ctx) throw new Error("Open /complex-work before issuing an order.");
    if (commandBusy || reconciling) throw new Error("Command post busy. Repeat the order shortly.");
    const mission = controller(ctx);
    commandBusy = true;
    try {
      if (key === "refresh") {
        commandBusy = false;
        await reconcile(ctx);
        return { kind: "refreshed" };
      }
      if (key === "start") {
        await withCommandLock(mission.root, async () => { await mission.start(input); });
        report("Naming your mission…", ctx);
        return { kind: "started", clearInput: true };
      }
      if (key.startsWith("remove/")) {
        const [, taskId, revision] = key.split("/");
        if (taskId !== ui.getSnapshot().context.selectedId) throw new Error("Open this mission before removing it.");
        await withCommandLock(mission.root, () => mission.remove(taskId, Number(revision)));
        clearPiBanner(ctx);
        report("Mission removed from the saved list. Reports, code, worktree, and branch retained.", ctx);
        return { kind: "removed", clearInput: true };
      }
      const [, taskId, revision, actionName, destination, candidateHead] = key.split("/");
      if (!key.startsWith("act/") || !ACTIONS.has(actionName as Action)) throw new Error("Unknown workspace order.");
      const task = mission.store.load(taskId);
      if (task.state.revision !== Number(revision)) throw new Error("Mission evidence changed. Inspect refreshed state and confirm again.");
      const action = actionName as Action;
      const target = action !== "merge" && destination ? targetStage(destination) : undefined;
      const approval = action === "merge" ? { sourceHead: destination, candidateHead } : undefined;
      if (approval && ![approval.sourceHead, approval.candidateHead].every(head => /^[a-f\d]{40,64}$/i.test(head ?? ""))) throw new Error("Invalid merge approval.");
      const reason = action === "end" && input.trim() === "validated" ? "Ended without merging" : input;
      const updated = await withCommandLock(mission.root, async () => {
        let next = await mission.act(taskId, task.state.revision, action, target, reason, "tui", approval);
        if (next.state.executionStatus === "ready" && action !== "pause" && !["merge", "end"].includes(next.state.currentState)) next = await mission.launch(taskId);
        return next;
      });
      report(`${updated.state.title}\n${missionSummary(updated)}`, ctx);
      return { kind: "updated", taskId: updated.state.taskId, clearInput: true };
    } finally {
      commandBusy = false;
      interviews.refresh();
      refreshWorkspace();
      if (reconciliationPending && context) void reconcile(context);
    }
  }

  async function dashboard(ctx: ExtensionCommandContext): Promise<void> {
    if (workspace) return report("Workspace is already open.", ctx);
    commandContext = ctx;
    ui.send({ type: "OPEN" });
    let panel: MissionWorkspace | undefined;
    try {
      await ctx.ui.custom<void>((tui, theme, _bindings, done) => {
        panel = new MissionWorkspace(tui, theme, ui, view, () => done());
        workspace = panel;
        panel.refresh();
        return panel;
      }, { overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", anchor: "top-left", margin: 0 } });
    } finally {
      if (workspace === panel) { workspace = undefined; observer.dispose(); ui.send({ type: "HIDE" }); }
    }
  }
  pi.registerCommand("complex-work", {
    description: "Open the full-screen workflow workspace. Esc returns to Pi; agents keep working.",
    handler: async (args, ctx) => {
      if (args.trim()) return report("/complex-work accepts no arguments. Issue orders inside its workspace.", ctx, true);
      if (!ctx.hasUI || ("mode" in ctx && ctx.mode !== "tui")) return report("Workflow steering requires the interactive Pi workspace.", ctx, true);
      try {
        context = ctx;
        clearPiBanner(ctx);
        refreshWorkspace();
        restoreSelection(ctx, projectRoot(ctx.cwd));
        void reconcile(ctx);
        await dashboard(ctx);
      } catch (error) { report(String(error), ctx, true); }
    },
  });
  function attachContext(ctx: ExtensionContext): void {
    ui.send({ type: "HIDE" });
    workspace?.close();
    workspace = undefined;
    observer.dispose();
    context = ctx;
    clearPiBanner(ctx);
    refreshWorkspace();
    restoreSelection(ctx, projectRoot(ctx.cwd));
    void reconcile(ctx);
  }
  pi.on("session_start", (_event, ctx) => attachContext(ctx));
  const unsubscribers = ["subagent:async-complete", "subagent:process-terminal", "subagents:rpc:v1:ready"].map(event => pi.events.on(event, payload => {
    if (event === "subagent:async-complete") {
      const runId = runner.observeCompletion(payload);
      if (runId) pendingCompletions.add(runId);
      if (pendingCompletions.size > 32) pendingCompletions.delete(pendingCompletions.values().next().value!);
    }
    if (context) void reconcile(context);
  }));
  pi.on("session_shutdown", () => {
    ui.send({ type: "HIDE" });
    workspace?.close();
    workspace = undefined;
    observer.dispose();
    interviews.dispose();
    context = undefined;
    commandContext = undefined;
    runner.dispose();
    ui.stop();
    for (const unsubscribe of unsubscribers) unsubscribe();
  });
}
