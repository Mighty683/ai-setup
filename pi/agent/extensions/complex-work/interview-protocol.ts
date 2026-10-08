/** Durable clarification transport. Question/answer data never authorizes workflow transitions. */
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import registerInterview from "../../npm/node_modules/pi-interview/index.ts";

export const INTERVIEW_BINDING = "complex-work.interview/1";
export interface InterviewBinding {
  directory: string;
  taskId: string;
  stageRunId: string;
  ownerSessionId: string;
}
export interface InterviewRequest {
  version: 1;
  id: string;
  binding: InterviewBinding;
  childSessionId: string;
  cwd: string;
  params: Record<string, unknown>;
}
export type InterviewTool = ToolDefinition<any, any>;
export type InterviewResult = Awaited<ReturnType<InterviewTool["execute"]>>;
export interface InterviewResponse { result?: InterviewResult; error?: string }

export function captureInterviewTool(pi: ExtensionAPI): InterviewTool {
  let tool: InterviewTool | undefined;
  registerInterview({ ...pi, registerTool: definition => { if (definition.name === "interview") tool = definition; } });
  if (!tool) throw new Error("pi-interview did not register its interview tool.");
  return tool;
}

export function safeTransportPath(path: string): string {
  const absolute = resolve(path);
  const parts = absolute.split(sep);
  for (let index = 1; index <= parts.length; index++) {
    const candidate = parts.slice(0, index).join(sep) || sep;
    if (existsSync(candidate) && lstatSync(candidate).isSymbolicLink()) throw new Error(`Refusing interview symlink: ${candidate}`);
  }
  return absolute;
}

export function transportFile(directory: string, id: string, kind: "request" | "response" | "cancel"): string {
  if (!/^[a-f\d-]{36}$/i.test(id)) throw new Error("Invalid interview request identity.");
  return safeTransportPath(join(directory, `${id}.${kind}.json`));
}

export function readTransport<T>(file: string): T {
  safeTransportPath(file);
  if (!lstatSync(file).isFile() || lstatSync(file).size > 1_000_000) throw new Error("Invalid or oversized interview record.");
  try { return JSON.parse(readFileSync(file, "utf8")) as T; }
  catch (error) { throw new Error(`Unreadable interview record: ${String(error)}`); }
}

export function writeTransport(file: string, value: unknown): void {
  safeTransportPath(file);
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value), { flag: "wx", mode: 0o600 });
  renameSync(temporary, file);
}
