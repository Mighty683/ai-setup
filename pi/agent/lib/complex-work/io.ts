// Bounded process execution and atomic evidence storage for controller-owned effects.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, realpath, lstat } from "node:fs/promises";
import path from "node:path";
import type { Check } from "../complex-work-contracts.ts";

export async function atomicJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await rename(temporary, file);
}
export async function readJson<T>(file: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
export type ProcessResult = { code: number; stdout: string; stderr: string; timedOut: boolean };
/** Kill the entire command group on timeout/cancellation; retain bounded output tails. */
export function runProcess(command: string, args: string[], cwd: string, options: {
  timeoutMs?: number; signal?: AbortSignal; env?: NodeJS.ProcessEnv; input?: string; strictOutputLimit?: number;
} = {}): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new Error("Cancelled")); return; }
    const child = spawn(command, args, {
      cwd, env: { ...process.env, ...options.env }, stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32", windowsHide: true,
    });
    let stdout = ""; let stderr = ""; let timedOut = false; let overflow = false;
    const terminate = () => {
      try { if (process.platform === "win32") child.kill("SIGKILL"); else if (child.pid) process.kill(-child.pid, "SIGKILL"); }
      catch { /* The process may have exited between the signal and the close event. */ }
    };
    const timer = setTimeout(() => { timedOut = true; terminate(); }, options.timeoutMs ?? 120_000);
    options.signal?.addEventListener("abort", terminate, { once: true });
    const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", terminate); };
    child.stdout.on("data", data => {
      stdout += data.toString();
      if (options.strictOutputLimit && Buffer.byteLength(stdout) > options.strictOutputLimit) { overflow = true; terminate(); }
      if (!options.strictOutputLimit) stdout = stdout.slice(-1_048_576);
    });
    child.stderr.on("data", data => { stderr = (stderr + data.toString()).slice(-1_048_576); });
    child.once("error", error => { cleanup(); reject(error); });
    child.once("close", code => {
      cleanup();
      if (overflow) reject(new Error(`Command output exceeds the ${options.strictOutputLimit}-byte artifact limit`));
      else resolve({ code: code ?? -1, stdout, stderr, timedOut });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(options.input);
  });
}
/** Reject symlink traversal, including dangling links and existing ancestor directories. */
export async function containedPath(root: string, relative: string): Promise<string> {
  const base = await realpath(root);
  const target = path.resolve(base, relative);
  if (target !== base && !target.startsWith(base + path.sep)) throw new Error("Path escapes the assigned checkout");
  const segments = path.relative(base, target).split(path.sep).filter(Boolean);
  let current = base;
  for (const segment of segments) {
    current = path.join(current, segment);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error(`Symlink traversal is not allowed: ${relative}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return target;
}
export type CheckEvidence = ProcessResult & { check: Check; cwd: string; startedAt: string; endedAt: string; cancelled?: boolean };
export async function runCheck(check: Check, root: string, signal?: AbortSignal): Promise<CheckEvidence> {
  const cwd = await containedPath(root, check.cwd ?? ".");
  const startedAt = new Date().toISOString();
  const result = await runProcess(check.command, check.args, cwd, { timeoutMs: check.timeoutMs, signal,
    env: { CARGO_TARGET_DIR: path.join(root, "target") } });
  return { ...result, check, cwd, startedAt, endedAt: new Date().toISOString() };
}
