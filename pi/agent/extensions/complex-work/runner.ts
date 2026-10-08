/** Pi-subagents public RPC adapter. Runtime JSON is evidence, never model routing output. */
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface RunnerReceipt {
  id: string;
  directory: string;
}

export interface RuntimeAgent {
  agent: string;
  model?: string;
  runId?: string;
}

export interface RunnerSnapshot {
  state: string;
  settled: boolean;
  error?: string;
  agents: RuntimeAgent[];
}

type RpcReply = {
  success: boolean;
  error?: { message: string };
  data?: { details?: { asyncId?: string; asyncDir?: string }; events?: { asyncComplete?: string }; session?: { sessionId?: string } };
};

interface RuntimeChild extends RuntimeAgent {
  id?: string;
  state?: string;
  status?: string;
  children?: RuntimeChild[];
  steps?: RuntimeChild[];
}

type NativeStatus = {
  runId?: string;
  state?: string;
  error?: string;
  steps?: RuntimeChild[];
  nestedChildren?: RuntimeChild[];
  processTerminal?: { state?: string };
};

function flattenChildren(children: RuntimeChild[]): RuntimeChild[] {
  return children.flatMap(child => [child, ...flattenChildren(child.children ?? []),
    ...flattenChildren((child.steps ?? []).flatMap(step => step.children ?? []))]);
}

const TERMINAL = new Set(["complete", "failed", "partial", "paused", "stopped", "rejected"]);

function readRuntimeJson<T>(file: string): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (error) {
    throw new Error(`Cannot read runner evidence ${file}. Preserve ownership; inspect the runner. ${String(error)}`);
  }
}

export class SubagentRunner {
  private disposers = new Set<() => void>();
  private completions = new Map<string, { agents: RuntimeChild[]; children: RuntimeChild[] }>();

  observeCompletion(payload: unknown): string | undefined {
    if (!payload || typeof payload !== "object") return undefined;
    const data = payload as { runId?: string; results?: RuntimeChild[]; nestedChildren?: RuntimeChild[] };
    if (!data.runId) return undefined;
    const nodes = flattenChildren([...(data.results ?? []), ...(data.nestedChildren ?? [])]);
    const agents = nodes.flatMap(child => [child, ...(child.steps ?? [])]);
    const children = flattenChildren([...(data.nestedChildren ?? []), ...(data.results ?? []).flatMap(result => result.children ?? [])]);
    this.completions.set(data.runId, { agents, children });
    if (this.completions.size > 32) this.completions.delete(this.completions.keys().next().value!);
    return data.runId;
  }

  completionAgents(runId: string): RuntimeAgent[] {
    return (this.completions.get(runId)?.agents ?? []).filter(child => Boolean(child.agent)).map(child => ({ agent: child.agent, model: child.model, runId: child.runId ?? child.id }));
  }

  constructor(private readonly pi: ExtensionAPI) {}

  request(method: string, params: Record<string, unknown> = {}, timeoutMs = 90_000): Promise<RpcReply["data"]> {
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const dispose = () => {
        clearTimeout(timer);
        unsubscribe();
        this.disposers.delete(cancel);
      };
      const cancel = () => {
        dispose();
        reject(new Error("Runner request interrupted. Reconcile before retrying."));
      };
      const unsubscribe = this.pi.events.on(`subagents:rpc:v1:reply:${requestId}`, (payload) => {
        const reply = payload as RpcReply;
        dispose();
        if (!reply.success) return reject(new Error(reply.error?.message ?? "Subagent RPC failed."));
        resolve(reply.data);
      });
      const timer = setTimeout(() => {
        dispose();
        reject(new Error(`Subagent ${method} did not acknowledge. Dispatch may still exist; do not relaunch blindly.`));
      }, timeoutMs);
      this.disposers.add(cancel);
      this.pi.events.emit("subagents:rpc:v1:request", {
        version: 1, requestId, method, params, source: { extension: "complex-work" },
      });
    });
  }

  async available(sessionId?: string): Promise<void> {
    const data = await this.request("ping", {}, 3_000);
    if (!data?.events?.asyncComplete) throw new Error("Install compatible pi-subagents (0.75+), then /reload.");
    if (sessionId && data.session?.sessionId !== sessionId) throw new Error("Runner session is not ready. Refresh status before dispatching.");
  }

  async launch(agent: string, task: string, cwd: string, output: string, extensionBindings?: Record<string, unknown>): Promise<RunnerReceipt> {
    const data = await this.request("spawn", {
      agent, task, cwd, output, outputMode: "file-only", context: "fresh", async: true,
      worktree: false, mission: false, outputSchema: false, extensionBindings,
      acceptance: { level: "none", reason: "User owns SDLC gates; Markdown findings only." },
    });
    const details = data?.details;
    if (!details?.asyncId || !details.asyncDir) throw new Error("Runner returned no dispatch identity. Inspect /subagents-fleet before retrying.");
    return { id: details.asyncId, directory: details.asyncDir };
  }

  async inspect(receipt: RunnerReceipt): Promise<RunnerSnapshot> {
    await this.request("status", { id: receipt.id, dir: receipt.directory });
    return this.snapshot(receipt.directory, receipt.id);
  }

  snapshot(directory: string, expectedRunId?: string): RunnerSnapshot {
    const statusFile = join(directory, "status.json");
    if (!existsSync(statusFile)) throw new Error("Runner status missing. Preserve ownership; inspect /subagents-fleet.");
    const status = readRuntimeJson<NativeStatus>(statusFile);
    if (expectedRunId && status.runId !== expectedRunId) throw new Error("Runner evidence identity mismatch. Preserve ownership and inspect the saved receipt.");
    const proofFile = join(directory, "process-terminal.json");
    const proof = existsSync(proofFile)
      ? readRuntimeJson<{ state?: string }>(proofFile)
      : status.processTerminal;
    const children = [...flattenChildren([...(status.nestedChildren ?? []), ...(status.steps ?? []).flatMap(step => step.children ?? [])]),
      ...(this.completions.get(status.runId ?? "")?.children ?? [])];
    const childrenSettled = children.every(child => TERMINAL.has(child.state ?? child.status ?? "unknown"));
    return {
      state: status.state ?? "unknown",
      settled: TERMINAL.has(status.state ?? "") && proof?.state === "observed" && childrenSettled,
      error: status.error,
      agents: [...(status.steps ?? []), ...children, ...this.completionAgents(status.runId ?? "")],
    };
  }

  /** Single-stage async runs retain their final response separately from the assigned findings. */
  finalOutput(receipt: RunnerReceipt): string | undefined {
    const file = join(receipt.directory, "output-0.log");
    if (!existsSync(file)) return undefined;
    if (!lstatSync(file).isFile()) throw new Error("Runner output must be a regular file.");
    return readFileSync(file, "utf8").slice(0, 100_000);
  }

  async stop(receipt: RunnerReceipt): Promise<RunnerSnapshot> {
    const snapshot = await this.inspect(receipt);
    if (snapshot.settled) return snapshot;
    if (TERMINAL.has(snapshot.state)) throw new Error("Run is terminal but process ownership is unproven. Wait for terminal proof, then refresh execution evidence in the panel.");
    await this.request("stop", { id: receipt.id, dir: receipt.directory });
    throw new Error("Stop ordered. Wait for the completion notice, then select the action again in the panel. State and code preserved.");
  }

  dispose(): void {
    for (const cancel of [...this.disposers]) cancel();
  }
}
