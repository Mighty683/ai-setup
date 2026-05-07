import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";

import { Agent, type AgentEvent, type AgentTool } from "@mariozechner/pi-agent-core";
import { Type, getModel } from "@mariozechner/pi-ai";
import type { AssistantMessage, Message, Model, ToolResultMessage } from "@mariozechner/pi-ai";

import { logBackendEvent, readRequestId, readJsonBody, sendJson, setNoStore } from "../common";
import {
	canSpawnSubagents,
	findAgentProfile,
	getAgentProfiles,
	getBuiltinDefaultAgentProfile,
	getPrimaryAgentCatalog,
	normalizeModelSelection,
	deriveAllowedToolsFromPermission,
} from "../opencode-permissions";
import { refreshCredentials } from "../oauth";
import { readState, updateState } from "../state";
import type { PersistedState } from "../state";
import type {
	AgentCatalogResponse,
	AgentRunRequestBody,
	AgentRunStreamEvent,
	ClientChatMessage,
	SystemNotificationMessage,
	ThinkingLevel,
} from "./types";

const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
const PROVIDERS = ["mistral", "openai-codex"] as const;
const MAX_SUBAGENT_DEPTH = 6;
const MAX_TOOL_OUTPUT_CHARS = 12_000;
const WALK_IGNORED_DIRS = new Set([".git", "node_modules", "dist", ".cache"]);

type RunAgentConversationArgs = {
	rootDir: string;
	agentId: string;
	modelId: string;
	thinkingLevel: ThinkingLevel;
	messages: ClientChatMessage[];
	depth: number;
	onEvent?: (event: AgentEvent) => Promise<void> | void;
};

type FlowEntry = {
	role: string;
	content: string;
	timestamp?: string;
};

export function validateAgentRunBody(body: Record<string, unknown>): AgentRunRequestBody {
	if (typeof body.agentId !== "string" || body.agentId.trim().length === 0) {
		throw new Error("agentId must be a non-empty string.");
	}
	if (typeof body.modelId !== "string" || body.modelId.trim().length === 0) {
		throw new Error("modelId must be a non-empty string.");
	}
	if (!Array.isArray(body.messages)) {
		throw new Error("messages must be an array.");
	}

	const thinkingLevel = typeof body.thinkingLevel === "string" ? (body.thinkingLevel as ThinkingLevel) : "off";
	if (!THINKING_LEVELS.includes(thinkingLevel)) {
		throw new Error(`Unsupported thinkingLevel '${thinkingLevel}'.`);
	}

	return {
		agentId: body.agentId.trim(),
		modelId: body.modelId.trim(),
		thinkingLevel,
		messages: body.messages as ClientChatMessage[],
	};
}

export async function handleAgentRunRequest(request: IncomingMessage, response: ServerResponse, rootDir: string): Promise<void> {
	const requestId = readRequestId(request.headers);
	const startedAt = Date.now();
	let body: AgentRunRequestBody;

	try {
		body = validateAgentRunBody(await readJsonBody(request));
	} catch (error) {
		sendJson(response, 400, { error: error instanceof Error ? error.message : "Invalid run request." });
		return;
	}

	setNoStore(response);
	response.writeHead(200, {
		"Cache-Control": "no-cache, no-transform",
		Connection: "keep-alive",
		"Content-Type": "text/event-stream; charset=utf-8",
	});
	response.write(": connected\n\n");

	const abortController = new AbortController();
	request.on("close", () => abortController.abort());

	logBackendEvent({
		event: "agent_operation",
		operation: "agent_run",
		phase: "start",
		requestId,
		agentId: body.agentId,
		modelId: body.modelId,
		thinkingLevel: body.thinkingLevel,
		messageCount: body.messages.length,
	});

	try {
		await runAgentConversation({
			rootDir,
			agentId: body.agentId,
			modelId: body.modelId,
			thinkingLevel: body.thinkingLevel || "off",
			messages: body.messages,
			depth: 0,
			onEvent: async (event) => {
				writeSse(response, { type: "agent_event", event });
			},
		});
		writeSse(response, { type: "run_completed" });
		logBackendEvent({
			event: "agent_operation",
			operation: "agent_run",
			phase: "end",
			status: abortController.signal.aborted ? "aborted" : "completed",
			durationMs: Date.now() - startedAt,
			requestId,
			agentId: body.agentId,
			modelId: body.modelId,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : "Agent run failed.";
		writeSse(response, {
			type: abortController.signal.aborted ? "run_aborted" : "run_failed",
			error: message,
		});
		logBackendEvent({
			event: "agent_operation",
			operation: "agent_run",
			phase: "end",
			status: abortController.signal.aborted ? "aborted" : "failed",
			errorMessage: message,
			durationMs: Date.now() - startedAt,
			requestId,
			agentId: body.agentId,
			modelId: body.modelId,
		});
	} finally {
		response.end();
	}
}

export async function handleCatalogRequest(response: ServerResponse, rootDir: string): Promise<void> {
	const catalog = await getPrimaryAgentCatalog(rootDir);
	const defaultAgent = catalog.agents[0] || getBuiltinDefaultAgentProfile();
	const payload: AgentCatalogResponse = {
		agents: catalog.agents.map((agent) => ({
			id: agent.id,
			model: agent.model,
			mode: agent.mode,
			role: agent.role,
			prompt: agent.prompt,
		})),
		models: catalog.models,
		providers: [...PROVIDERS],
		defaultAgentId: defaultAgent.id,
		defaultModelId: defaultAgent.model,
		thinkingLevels: THINKING_LEVELS,
	};

	setNoStore(response);
	sendJson(response, 200, payload);
}

export async function runSubagentTask(args: {
	rootDir: string;
	agentId: string;
	task: string;
	thinkingLevel: ThinkingLevel;
	depth: number;
}): Promise<{ summary: string; status: "completed" | "failed"; errorMessage?: string; flow: FlowEntry[]; messages: ClientChatMessage[] }> {
	const userMessage: Message = {
		role: "user",
		content: [{ type: "text", text: args.task }],
		timestamp: Date.now(),
	};
	const messages: ClientChatMessage[] = [userMessage];

	try {
		const result = await runAgentConversation({
			rootDir: args.rootDir,
			agentId: args.agentId,
			modelId: (await requireAgentProfile(args.rootDir, args.agentId)).model,
			thinkingLevel: args.thinkingLevel,
			messages,
			depth: args.depth,
		});
		const flow = buildFlowFromMessages(result.messages);
		return {
			summary: extractLatestAssistantText(result.messages) || "(empty response)",
			status: result.errorMessage ? "failed" : "completed",
			errorMessage: result.errorMessage,
			flow,
			messages: result.messages,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Subagent failed";
		return {
			summary: errorMessage,
			status: "failed",
			errorMessage,
			flow: [
				{ role: "user", content: args.task, timestamp: new Date(userMessage.timestamp).toISOString() },
				{ role: "assistant", content: errorMessage, timestamp: new Date().toISOString() },
			],
			messages,
		};
	}
}

async function runAgentConversation(args: RunAgentConversationArgs): Promise<{ messages: ClientChatMessage[]; errorMessage?: string }> {
	if (args.depth > MAX_SUBAGENT_DEPTH) {
		throw new Error(`Maximum subagent depth of ${MAX_SUBAGENT_DEPTH} exceeded.`);
	}

	const profile = await requireAgentProfile(args.rootDir, args.agentId);
	const resolvedModel = resolveBackendModel(args.modelId || profile.model);
	if (!resolvedModel) {
		throw new Error(`Unable to resolve model '${args.modelId || profile.model}'.`);
	}

	const tools = await buildAgentTools({
		rootDir: args.rootDir,
		permission: profile.permission,
		thinkingLevel: args.thinkingLevel,
		depth: args.depth,
	});
	const initialMessages = args.messages.slice();
	const state = await readState();
	let credentialsState = state;

	const agent = new Agent({
		initialState: {
			systemPrompt: profile.prompt,
			thinkingLevel: args.thinkingLevel,
			messages: initialMessages as never[],
			tools,
			model: resolvedModel,
		},
		convertToLlm: convertMessagesForModel,
		toolExecution: "parallel",
		getApiKey: async (provider) => {
			credentialsState = await ensureProviderCredentials(provider, credentialsState);
			if (provider === "mistral") {
				return credentialsState.mistralApiKey;
			}
			if (provider === "openai-codex") {
				return credentialsState.openAICodexCredentials?.access || "";
			}
			return "";
		},
	});

	if (args.onEvent) {
		agent.subscribe(async (event) => {
			await args.onEvent?.(event);
		});
	}

	await agent.continue();
	return { messages: agent.state.messages as unknown as ClientChatMessage[], errorMessage: agent.state.errorMessage };
}

async function requireAgentProfile(rootDir: string, agentId: string) {
	const profile = await findAgentProfile(agentId, rootDir);
	if (!profile) {
		throw new Error(`Unknown agent profile: ${agentId}`);
	}
	return profile;
}

async function resolveSubagentProfileId(
	rootDir: string,
	input: { agentId?: string; agentType?: string },
): Promise<string> {
	const allProfiles = await getAgentProfiles(rootDir);
	const subagents = allProfiles.filter((profile) => profile.mode === "subagent");

	if (subagents.length === 0) {
		throw new Error("No subagent profiles are configured.");
	}

	const normalizedId = normalizeAgentAlias(input.agentId || "");
	const normalizedType = normalizeAgentAlias(input.agentType || "");

	const byType =
		normalizedType === ""
			? []
			: subagents.filter((profile) => {
				const id = normalizeAgentAlias(profile.id);
				const role = normalizeAgentAlias(profile.role || "");
				return id.includes(normalizedType) || role.includes(normalizedType);
			});

	if (normalizedId) {
		const exact = subagents.find((profile) => normalizeAgentAlias(profile.id) === normalizedId);
		if (exact) {
			return exact.id;
		}

		const prefix = subagents.find((profile) => normalizedId.startsWith(normalizeAgentAlias(profile.id)));
		if (prefix) {
			return prefix.id;
		}

		const partial = subagents.find((profile) => normalizeAgentAlias(profile.id).includes(normalizedId));
		if (partial) {
			return partial.id;
		}
	}

	if (byType.length === 1) {
		return byType[0].id;
	}

	if (!normalizedId && byType.length > 1) {
		throw new Error(`Ambiguous subagent type '${input.agentType}'. Candidates: ${byType.map((profile) => profile.id).join(", ")}`);
	}

	throw new Error(
		`Unknown subagent profile '${input.agentId || input.agentType || ""}'. Available: ${subagents.map((profile) => profile.id).join(", ")}`,
	);
}

function normalizeAgentAlias(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[_\s]+/g, "-")
		.replace(/[^a-z0-9-]/g, "")
		.replace(/-\d+$/, "")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

function resolveBackendModel(modelId: string): Model<any> | undefined {
	const normalized = normalizeModelSelection(modelId);
	try {
		return getModel(normalized.provider, normalized.modelId as never) as Model<any>;
	} catch {
		try {
			return getModel(normalized.provider, modelId as never) as Model<any>;
		} catch {
			return undefined;
		}
	}
}

async function ensureProviderCredentials(provider: string, state: PersistedState): Promise<PersistedState> {
	if (provider === "mistral") {
		if (!state.mistralApiKey.trim()) {
			throw new Error("Missing Mistral API key. Save it in settings.");
		}
		return state;
	}

	if (provider !== "openai-codex") {
		throw new Error(`Unsupported provider '${provider}'.`);
	}

	const credentials = state.openAICodexCredentials;
	if (!credentials) {
		throw new Error("Missing OpenAI Codex credentials. Log in from settings.");
	}

	if (credentials.expires > Date.now() + 30_000) {
		return state;
	}

	const refreshed = await refreshCredentials(credentials.refresh);
	return await updateState((current) => ({
		...current,
		openAICodexCredentials: refreshed,
	}));
}

function convertMessagesForModel(messages: ClientChatMessage[]): Message[] {
	return messages
		.map((message): Message | undefined => {
			if (isSystemNotification(message)) {
				return {
					role: "user",
					content: `<system>${message.message}</system>`,
					timestamp: Date.now(),
				};
			}

			if (message.role === "user" || message.role === "assistant" || message.role === "toolResult") {
				return message;
			}

			return undefined;
		})
		.filter((message): message is Message => Boolean(message));
}

function isSystemNotification(message: ClientChatMessage): message is SystemNotificationMessage {
	return message.role === "system-notification";
}

async function buildAgentTools(args: {
	rootDir: string;
	permission: unknown;
	thinkingLevel: ThinkingLevel;
	depth: number;
}): Promise<AgentTool<any>[]> {
	const tools: AgentTool<any>[] = [];
	const allowedToolNames = deriveAllowedToolsFromPermission(args.permission);

	for (const toolName of allowedToolNames) {
		if (toolName === "read") {
			tools.push(createReadTool(args.rootDir));
		}
		if (toolName === "ls") {
			tools.push(createListTool(args.rootDir));
		}
		if (toolName === "find") {
			tools.push(createFindTool(args.rootDir));
		}
		if (toolName === "grep") {
			tools.push(createGrepTool(args.rootDir));
		}
		if (toolName === "write") {
			tools.push(createWriteTool(args.rootDir));
		}
		if (toolName === "edit") {
			tools.push(createEditTool(args.rootDir));
		}
		if (toolName === "bash") {
			tools.push(createBashTool(args.rootDir));
		}
	}

	if (canSpawnSubagents(args.permission)) {
		tools.push(createRunSubagentTool(args.rootDir, args.thinkingLevel, args.depth));
	}

	return tools;
}

function createReadTool(rootDir: string): AgentTool<any> {
	return {
		name: "read",
		label: "Read file",
		description: "Read a file from the workspace with optional line range.",
		parameters: Type.Object({
			path: Type.String(),
			startLine: Type.Optional(Type.Number({ minimum: 1 })),
			endLine: Type.Optional(Type.Number({ minimum: 1 })),
		}),
		execute: async (_toolCallId, params) => {
			const filePath = resolveWorkspacePath(rootDir, params.path);
			const raw = await readFile(filePath, "utf8");
			const lines = raw.split(/\r?\n/);
			const start = Math.max(1, Number(params.startLine || 1));
			const end = Math.max(start, Number(params.endLine || lines.length));
			const content = lines
				.slice(start - 1, end)
				.map((line, index) => `${start + index}: ${line}`)
				.join("\n");
			return toolTextResult(content || "(empty file)", { path: relativeWorkspacePath(rootDir, filePath), startLine: start, endLine: end });
		},
	};
}

function createListTool(rootDir: string): AgentTool<any> {
	return {
		name: "ls",
		label: "List directory",
		description: "List files and directories under a workspace path.",
		parameters: Type.Object({
			path: Type.Optional(Type.String()),
		}),
		execute: async (_toolCallId, params) => {
			const dirPath = resolveWorkspacePath(rootDir, params.path || ".");
			const entries = await readdir(dirPath, { withFileTypes: true });
			const content = entries.map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`).join("\n");
			return toolTextResult(content || "(empty directory)", { path: relativeWorkspacePath(rootDir, dirPath), count: entries.length });
		},
	};
}

function createFindTool(rootDir: string): AgentTool<any> {
	return {
		name: "find",
		label: "Find files",
		description: "Find files in the workspace by a simple glob-like pattern.",
		parameters: Type.Object({
			pattern: Type.String(),
			path: Type.Optional(Type.String()),
			limit: Type.Optional(Type.Number({ minimum: 1, maximum: 500 })),
		}),
		execute: async (_toolCallId, params) => {
			const basePath = resolveWorkspacePath(rootDir, params.path || ".");
			const regex = globLikePatternToRegExp(params.pattern);
			const matches: string[] = [];
			for await (const filePath of walkFiles(basePath)) {
				const relative = relativeWorkspacePath(rootDir, filePath);
				if (regex.test(relative)) {
					matches.push(relative);
				}
				if (matches.length >= Number(params.limit || 100)) {
					break;
				}
			}
			return toolTextResult(matches.join("\n") || "(no matches)", { path: relativeWorkspacePath(rootDir, basePath), pattern: params.pattern, count: matches.length });
		},
	};
}

function createGrepTool(rootDir: string): AgentTool<any> {
	return {
		name: "grep",
		label: "Search file contents",
		description: "Search workspace files using a regular expression.",
		parameters: Type.Object({
			pattern: Type.String(),
			path: Type.Optional(Type.String()),
			include: Type.Optional(Type.String()),
			limit: Type.Optional(Type.Number({ minimum: 1, maximum: 500 })),
		}),
		execute: async (_toolCallId, params) => {
			const basePath = resolveWorkspacePath(rootDir, params.path || ".");
			const includeRegex = params.include ? globLikePatternToRegExp(params.include) : null;
			const pattern = new RegExp(params.pattern, "i");
			const matches: string[] = [];
			for await (const filePath of walkFiles(basePath)) {
				const relative = relativeWorkspacePath(rootDir, filePath);
				if (includeRegex && !includeRegex.test(relative)) {
					continue;
				}
				const raw = await safeReadText(filePath);
				if (raw === null) {
					continue;
				}
				const lines = raw.split(/\r?\n/);
				for (let index = 0; index < lines.length; index += 1) {
					if (pattern.test(lines[index] || "")) {
						matches.push(`${relative}:${index + 1}: ${lines[index]}`);
						if (matches.length >= Number(params.limit || 100)) {
							return toolTextResult(matches.join("\n"), { pattern: params.pattern, count: matches.length });
						}
					}
				}
			}
			return toolTextResult(matches.join("\n") || "(no matches)", { pattern: params.pattern, count: matches.length });
		},
	};
}

function createWriteTool(rootDir: string): AgentTool<any> {
	return {
		name: "write",
		label: "Write file",
		description: "Write content to a workspace file.",
		parameters: Type.Object({
			path: Type.String(),
			content: Type.String(),
		}),
		execute: async (_toolCallId, params) => {
			const filePath = resolveWorkspacePath(rootDir, params.path);
			await mkdir(dirname(filePath), { recursive: true });
			await writeFile(filePath, params.content, "utf8");
			return toolTextResult(`Wrote ${params.content.length} characters to ${relativeWorkspacePath(rootDir, filePath)}.`, {
				path: relativeWorkspacePath(rootDir, filePath),
				bytes: Buffer.byteLength(params.content, "utf8"),
			});
		},
	};
}

function createEditTool(rootDir: string): AgentTool<any> {
	return {
		name: "edit",
		label: "Edit file",
		description: "Replace text in a workspace file.",
		parameters: Type.Object({
			path: Type.String(),
			search: Type.String(),
			replace: Type.String(),
			all: Type.Optional(Type.Boolean()),
		}),
		execute: async (_toolCallId, params) => {
			const filePath = resolveWorkspacePath(rootDir, params.path);
			const raw = await readFile(filePath, "utf8");
			if (!params.search) {
				throw new Error("search must be non-empty.");
			}
			const occurrences = raw.split(params.search).length - 1;
			if (occurrences === 0) {
				throw new Error(`Search text not found in ${relativeWorkspacePath(rootDir, filePath)}.`);
			}
			const next = params.all ? raw.split(params.search).join(params.replace) : raw.replace(params.search, params.replace);
			await writeFile(filePath, next, "utf8");
			return toolTextResult(`Updated ${relativeWorkspacePath(rootDir, filePath)}.`, {
				path: relativeWorkspacePath(rootDir, filePath),
				replacements: params.all ? occurrences : 1,
			});
		},
	};
}

function createBashTool(rootDir: string): AgentTool<any> {
	return {
		name: "bash",
		label: "Run shell command",
		description: "Run a shell command inside the workspace.",
		parameters: Type.Object({
			command: Type.String(),
			workdir: Type.Optional(Type.String()),
			timeoutMs: Type.Optional(Type.Number({ minimum: 1000, maximum: 300000 })),
		}),
		execute: async (_toolCallId, params) => {
			const workdir = resolveWorkspacePath(rootDir, params.workdir || ".");
			const result = await executeShellCommand(params.command, workdir, Number(params.timeoutMs || 120000));
			const output = trimOutput([result.stdout, result.stderr].filter(Boolean).join(result.stdout && result.stderr ? "\n" : ""));
			return toolTextResult(output || "(no output)", {
				workdir: relativeWorkspacePath(rootDir, workdir),
				exitCode: result.exitCode,
			});
		},
	};
}

function createRunSubagentTool(rootDir: string, thinkingLevel: ThinkingLevel, depth: number): AgentTool<any> {
	return {
		name: "run_subagent",
		label: "Run subagent",
		description: "Delegate a task to a configured backend subagent.",
		parameters: Type.Object({
			agentId: Type.Optional(Type.String()),
			agentType: Type.Optional(Type.String()),
			task: Type.String(),
			thinkingLevel: Type.Optional(Type.String()),
		}),
		execute: async (_toolCallId, params, _signal, onUpdate) => {
			const resolvedAgentId = await resolveSubagentProfileId(rootDir, {
				agentId: typeof params.agentId === "string" ? params.agentId : undefined,
				agentType: typeof params.agentType === "string" ? params.agentType : undefined,
			});

			const result = await runSubagentTask({
				rootDir,
				agentId: resolvedAgentId,
				task: params.task,
				thinkingLevel: normalizeThinkingLevel(params.thinkingLevel, thinkingLevel),
				depth: depth + 1,
			});

			onUpdate?.({
				content: [{ type: "text", text: result.summary }],
				details: {
					agentId: resolvedAgentId,
					task: params.task,
					status: result.status,
				},
			});

			return {
				content: [{ type: "text", text: result.summary }],
				details: {
					agentId: resolvedAgentId,
					task: params.task,
					summary: result.summary,
					status: result.status,
					errorMessage: result.errorMessage,
					flow: result.flow,
					messages: result.messages,
					arguments: params,
				},
			};
		},
	};
}

function toolTextResult(content: string, details: Record<string, unknown>) {
	return {
		content: [{ type: "text" as const, text: trimOutput(content) }],
		details,
	};
}

function normalizeThinkingLevel(value: unknown, fallback: ThinkingLevel): ThinkingLevel {
	return typeof value === "string" && THINKING_LEVELS.includes(value as ThinkingLevel) ? (value as ThinkingLevel) : fallback;
}

function writeSse(response: ServerResponse, payload: AgentRunStreamEvent): void {
	response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function resolveWorkspaceRoot(rootDir: string): string {
	return resolve(rootDir, "..");
}

function resolveWorkspacePath(rootDir: string, targetPath: string): string {
	const workspaceRoot = resolveWorkspaceRoot(rootDir);
	const resolvedTarget = resolve(workspaceRoot, targetPath || ".");
	if (resolvedTarget !== workspaceRoot && !resolvedTarget.startsWith(`${workspaceRoot}${sep}`)) {
		throw new Error(`Path escapes workspace root: ${targetPath}`);
	}
	return resolvedTarget;
}

function relativeWorkspacePath(rootDir: string, targetPath: string): string {
	const workspaceRoot = resolveWorkspaceRoot(rootDir);
	return targetPath.startsWith(`${workspaceRoot}${sep}`) ? targetPath.slice(workspaceRoot.length + 1) : ".";
}

async function* walkFiles(basePath: string): AsyncGenerator<string> {
	const entries = await readdir(basePath, { withFileTypes: true });
	for (const entry of entries) {
		if (WALK_IGNORED_DIRS.has(entry.name)) {
			continue;
		}
		const entryPath = resolve(basePath, entry.name);
		if (entry.isDirectory()) {
			yield* walkFiles(entryPath);
			continue;
		}
		if (entry.isFile()) {
			yield entryPath;
		}
	}
}

function globLikePatternToRegExp(pattern: string): RegExp {
	const escaped = pattern
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*\*/g, "__DOUBLE_STAR__")
		.replace(/\*/g, "[^/]*")
		.replace(/__DOUBLE_STAR__/g, ".*")
		.replace(/\?/g, ".");
	return new RegExp(`^${escaped}$`, "i");
}

async function safeReadText(filePath: string): Promise<string | null> {
	const fileStats = await stat(filePath);
	if (fileStats.size > 512 * 1024) {
		return null;
	}
	if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".zip"].includes(extname(filePath).toLowerCase())) {
		return null;
	}
	try {
		return await readFile(filePath, "utf8");
	} catch {
		return null;
	}
}

function trimOutput(output: string): string {
	return output.length > MAX_TOOL_OUTPUT_CHARS ? `${output.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n…(truncated)` : output;
}

function executeShellCommand(command: string, workdir: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
	return new Promise((resolvePromise, rejectPromise) => {
		const child = spawn("zsh", ["-lc", command], { cwd: workdir, env: process.env });
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill("SIGTERM");
			rejectPromise(new Error(`Command timed out after ${timeoutMs}ms.`));
		}, timeoutMs);

		child.stdout.on("data", (chunk) => {
			stdout += String(chunk);
		});
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});
		child.on("error", (error) => {
			clearTimeout(timer);
			rejectPromise(error);
		});
		child.on("close", (exitCode) => {
			clearTimeout(timer);
			resolvePromise({ stdout, stderr, exitCode });
		});
	});
}

function buildFlowFromMessages(messages: ClientChatMessage[]): FlowEntry[] {
	return messages.map((message) => ({
		role: message.role,
		content: messageToPlainText(message),
		timestamp: messageTimestamp(message),
	}));
}

function extractLatestAssistantText(messages: ClientChatMessage[]): string {
	const assistantMessage = [...messages].reverse().find((message): message is AssistantMessage => message.role === "assistant");
	return assistantMessage ? messageToPlainText(assistantMessage) : "";
}

function messageTimestamp(message: ClientChatMessage): string | undefined {
	if (message.role === "system-notification") {
		return message.timestamp;
	}
	return typeof message.timestamp === "number" ? new Date(message.timestamp).toISOString() : undefined;
}

function messageToPlainText(message: ClientChatMessage): string {
	if (message.role === "system-notification") {
		return message.message;
	}
	if (message.role === "user") {
		if (typeof message.content === "string") {
			return message.content;
		}
		return message.content
			.map((block) => (block.type === "text" ? block.text : block.type === "image" ? `[image:${block.mimeType}]` : ""))
			.filter(Boolean)
			.join("\n");
	}
	if (message.role === "assistant") {
		return message.content
			.map((block) => {
				if (block.type === "text") {
					return block.text;
				}
				if (block.type === "thinking") {
					return block.thinking;
				}
				if (block.type === "toolCall") {
					return `[tool:${block.name}] ${JSON.stringify(block.arguments)}`;
				}
				return "";
			})
			.filter(Boolean)
			.join("\n");
	}
	return (message as ToolResultMessage).content.map((block) => block.type === "text" ? block.text : `[image:${block.mimeType}]`).join("\n");
}
