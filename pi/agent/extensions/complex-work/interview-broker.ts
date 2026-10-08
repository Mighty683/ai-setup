/** Presents child-owned clarification forms in the real interactive host; never changes a task's stage. */
import { existsSync, mkdirSync, readdirSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { TaskStore, type StageRun, type TaskRecord } from "./state.ts";
import { captureInterviewTool, readTransport, safeTransportPath, transportFile, writeTransport,
  type InterviewBinding, type InterviewRequest, type InterviewResponse, type InterviewTool } from "./interview-protocol.ts";

interface PendingInterview { request: InterviewRequest; abort: AbortController }

export class InterviewBroker {
  private readonly provider: InterviewTool;
  private watcher?: FSWatcher;
  private context?: ExtensionContext;
  private ownerSessionId?: string;
  private root?: string;
  private queue: PendingInterview[] = [];
  private active?: PendingInterview;
  private draining = false;
  private seen = new Set<string>();
  private changed: () => void = () => {};

  constructor(pi: ExtensionAPI, private readonly warn: (message: string) => void) {
    this.provider = captureInterviewTool(pi);
  }

  attach(root: string, context: ExtensionContext, changed: () => void): void {
    if (this.root === root && this.ownerSessionId === context.sessionManager.getSessionId()) {
      this.context = context;
      this.changed = changed;
      this.ensureWatcher();
      return;
    }
    this.dispose();
    this.root = root;
    this.context = context;
    this.ownerSessionId = context.sessionManager.getSessionId();
    this.changed = changed;
    this.ensureWatcher();
  }

  prepare(task: TaskRecord, run: StageRun): InterviewBinding {
    const ownerSessionId = task.state.ownerSessionId;
    if (!ownerSessionId || ownerSessionId !== this.ownerSessionId) throw new Error("Interview owner does not match this Pi session.");
    const directory = safeTransportPath(join(task.folder, ".interviews", run.id));
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.ensureWatcher();
    return { directory, taskId: task.state.taskId, stageRunId: run.id, ownerSessionId };
  }

  cancelRun(task: TaskRecord, run: StageRun): void {
    const directory = safeTransportPath(join(task.folder, ".interviews", run.id));
    if (!existsSync(directory)) return;
    writeTransport(join(directory, "closed.json"), { reason: "User ordered navigation or shutdown." });
    for (const pending of [...this.queue, ...(this.active ? [this.active] : [])]) {
      if (pending.request.binding.stageRunId === run.id) pending.abort.abort();
    }
    this.scan();
  }

  refresh(): void { this.scan(); }

  summary(): string | undefined {
    if (!this.active && !this.queue.length) return undefined;
    return `Interview: ${this.active ? "awaiting your answers in the form" : "queued"} · ${this.queue.length} queued`;
  }

  private ensureWatcher(): void {
    if (!this.root || this.watcher) return;
    const directory = safeTransportPath(join(this.root, "docs", "tasks"));
    if (!existsSync(directory)) return;
    this.watcher = watch(directory, { recursive: true }, (_event, filename) => {
      if (!filename || /\.(request|cancel)\.json$/.test(String(filename))) this.scan();
    });
    this.watcher.on("error", error => this.warn(`Interview watcher failed: ${error.message}`));
    this.scan();
  }

  private respond(pending: PendingInterview, response: InterviewResponse): void {
    const file = transportFile(pending.request.binding.directory, pending.request.id, "response");
    if (!existsSync(file)) writeTransport(file, response);
  }

  private scan(): void {
    if (!this.root || !this.context) return;
    try {
      const tasks = new TaskStore(this.root).list();
      for (const task of tasks) this.scanTask(task);
      const live = new Set(tasks.filter(task => task.state.ownerSessionId === this.ownerSessionId)
        .flatMap(task => task.state.stageRuns.filter(run => ['running', 'dispatching'].includes(run.status)).map(run => run.id)));
      for (const pending of [...this.queue, ...(this.active ? [this.active] : [])]) {
        const cancel = transportFile(pending.request.binding.directory, pending.request.id, "cancel");
        if (existsSync(cancel) || !live.has(pending.request.binding.stageRunId)
          || existsSync(join(pending.request.binding.directory, "closed.json"))) pending.abort.abort();
      }
      void this.drain();
    } catch (error) { this.warn(`Interview reconciliation blocked: ${String(error)}`); }
    this.changed();
  }

  private scanTask(task: TaskRecord): void {
    if (task.state.ownerSessionId !== this.ownerSessionId) return;
    for (const run of task.state.stageRuns) {
      if (!['running', 'dispatching'].includes(run.status)) continue;
      const directory = safeTransportPath(join(task.folder, ".interviews", run.id));
      if (!existsSync(directory)) continue;
      for (const name of readdirSync(directory)) this.admit(task, run, directory, name);
    }
  }

  private admit(task: TaskRecord, run: StageRun, directory: string, name: string): void {
    if (!/^[a-f\d-]{36}\.request\.json$/i.test(name)) return;
    const file = join(directory, name);
    if (this.seen.has(file)) return;
    const request = readTransport<InterviewRequest>(file);
    const binding = request.binding;
    if (request.version !== 1 || !binding || binding.directory !== directory || binding.taskId !== task.state.taskId
      || binding.stageRunId !== run.id || binding.ownerSessionId !== task.state.ownerSessionId
      || name !== `${request.id}.request.json` || !request.params || typeof request.cwd !== "string") {
      throw new Error(`Invalid interview request identity: ${file}`);
    }
    this.seen.add(file);
    if (existsSync(transportFile(directory, request.id, "response"))) return;
    this.queue.push({ request, abort: new AbortController() });
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.context && this.queue.length) {
        const pending = this.queue.shift();
        if (!pending) break;
        this.active = pending;
        this.changed();
        await this.present(pending, this.context);
        this.active = undefined;
        this.changed();
      }
    } finally { this.draining = false; }
  }

  private async present(pending: PendingInterview, context: ExtensionContext): Promise<void> {
    try {
      if (!context.hasUI) throw new Error("Interviews require the originating interactive Pi session.");
      if (pending.abort.signal.aborted) throw new Error("Interview cancelled before presentation.");
      const toolContext: Parameters<InterviewTool["execute"]>[4] = Object.defineProperties(Object.create(context), {
        cwd: { value: pending.request.cwd },
        signal: { value: pending.abort.signal },
        tools: { value: [] },
        executeTool: { value: async () => { throw new Error("Nested tools are unavailable in the interview broker."); } },
      });
      const result = await this.provider.execute(pending.request.id, { ...pending.request.params, async: false }, pending.abort.signal, update => {
        const details = update.details as { queuedMessage?: string } | undefined;
        const message = details?.queuedMessage ?? update.content.flatMap(item => item.type === "text" ? [item.text] : []).join("\n");
        if (message) context.ui.notify(message, "info");
      }, toolContext);
      const details = result.details as { status?: string; responses?: unknown } | undefined;
      if (pending.abort.signal.aborted || details?.status !== "completed") {
        throw new Error(`Interview ${details?.status ?? "unavailable"}. Preserve unresolved questions as blockers; do not guess or proceed on defaults. Partial answers: ${JSON.stringify(details?.responses ?? [])}`);
      }
      this.respond(pending, { result });
    } catch (error) {
      try { this.respond(pending, { error: String(error) }); }
      catch (writeError) { this.warn(`Interview response could not be saved: ${String(writeError)}`); }
    }
  }

  dispose(): void {
    this.watcher?.close();
    this.watcher = undefined;
    const pending = [...this.queue, ...(this.active ? [this.active] : [])];
    this.queue = [];
    this.context = undefined;
    this.ownerSessionId = undefined;
    this.root = undefined;
    for (const interview of pending) {
      interview.abort.abort();
      try { this.respond(interview, { error: "Main Pi session closed or changed. Preserve questions; retry from the owning session." }); }
      catch (error) { this.warn(`Interview shutdown response failed: ${String(error)}`); }
    }
    this.seen.clear();
  }
}
