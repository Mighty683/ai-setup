// Reattach to durable command evidence instead of repeating checks after a controller restart.
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Check } from "../complex-work-contracts.ts";
import { atomicJson, containedPath, readJson, type CheckEvidence } from "./io.ts";

export async function durableCheck(check: Check, root: string, evidenceRoot: string, signal: AbortSignal): Promise<CheckEvidence> {
  const cwd = await containedPath(root, check.cwd ?? ".");
  await mkdir(evidenceRoot, { recursive: true });
  const stem = path.join(evidenceRoot, check.id);
  const config = { check, cwd, resultFile: `${stem}.result.json`, lockFile: `${stem}.lock`, cancelFile: `${stem}.cancel` };
  const existing = await readJson<CheckEvidence>(config.resultFile);
  if (existing) return existing;
  await atomicJson(`${stem}.config.json`, config);
  const worker = spawn(process.execPath, [fileURLToPath(new URL("./check-worker.mjs", import.meta.url)), `${stem}.config.json`],
    { cwd, detached: true, stdio: "ignore", windowsHide: true });
  let launchError: Error | undefined;
  worker.once("error", error => { launchError = error; }); worker.unref();
  const deadline = Date.now() + check.timeoutMs + 30_000;
  while (Date.now() < deadline) {
    if (signal.aborted) await writeFile(config.cancelFile, "cancel");
    if (launchError) throw launchError;
    const result = await readJson<CheckEvidence>(config.resultFile);
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await writeFile(config.cancelFile, "cancel");
  throw new Error(`Check supervisor did not return terminal evidence: ${config.resultFile}`);
}
