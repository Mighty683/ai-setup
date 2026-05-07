import type { IncomingMessage, ServerResponse } from "node:http";
import { getModel, getModels, streamSimple } from "@mariozechner/pi-ai";
import type { Model } from "@mariozechner/pi-ai";
import { logBackendEvent, readRequestId } from "../common";
import { deriveAllowedToolsFromPermission, readOpencodeConfig } from "../opencode-permissions";
import { DEFAULT_AGENT_ID, updateState } from "../state";
import type {
	OpencodeAgentProfile,
	ResolvedSubagentModel,
	SubagentFlowEntry,
	SubagentHelpers,
	SubagentModelResolution,
	SubagentRunRequestBody,
	SubagentRunResponse,
	SubagentState,
} from "./types";

const BUILTIN_DEFAULT_AGENT_MODEL = "openai/gpt-5.3-codex";

const BUILTIN_DEFAULT_AGENT_PROMPT =
	"You are a minimal coding agent. Solve the requested coding task with clear reasoning, minimal changes, and concise explanations.";

function getBuiltinDefaultAgentProfile(): OpencodeAgentProfile {
	return {
		id: DEFAULT_AGENT_ID,
		model: BUILTIN_DEFAULT_AGENT_MODEL,
		mode: "subagent",
		prompt: BUILTIN_DEFAULT_AGENT_PROMPT,
		permission: undefined,
	};
}

export function validateSubagentRunBody(body: Record<string, unknown>): SubagentRunRequestBody {
	if (typeof body.agentId !== "string" || body.agentId.trim().length === 0) {
		throw new Error("agentId must be a non-empty string.");
	}
	if (typeof body.task !== "string" || body.task.trim().length === 0) {
		throw new Error("task must be a non-empty string.");
	}

	const next: SubagentRunRequestBody = {
		agentId: body.agentId,
		task: body.task,
	};

	if (typeof body.mistralApiKey === "string") {
		next.mistralApiKey = body.mistralApiKey;
	}
	if (typeof body.openAIAccessToken === "string") {
		next.openAIAccessToken = body.openAIAccessToken;
	}
	if (typeof body.thinkingLevel === "string") {
		next.thinkingLevel = body.thinkingLevel as SubagentRunRequestBody["thinkingLevel"];
	}

	return next;
}

export async function findOpencodeSubagentProfile(
	agentId: string,
	rootDir: string,
): Promise<OpencodeAgentProfile | undefined> {
	if (agentId === DEFAULT_AGENT_ID) {
		return getBuiltinDefaultAgentProfile();
	}

	const config = (await readOpencodeConfig(rootDir)) as {
		agent?: Record<string, { model?: unknown; mode?: unknown; prompt?: unknown; permission?: unknown }>;
	};
	if (!config.agent || typeof config.agent !== "object") {
		return undefined;
	}

	const definition = config.agent[agentId];
	if (!definition) {
		return undefined;
	}

	if (definition.mode !== "subagent") {
		throw new Error(`Agent profile '${agentId}' is not a subagent (mode=${String(definition.mode)}).`);
	}

	if (typeof definition.model !== "string" || definition.model.length === 0) {
		throw new Error(`Agent profile '${agentId}' is missing a valid model.`);
	}

	return {
		id: agentId,
		model: definition.model,
		mode: "subagent",
		prompt: typeof definition.prompt === "string" ? definition.prompt : "",
		permission: definition.permission,
	};
}

export function normalizeModelSelection(inputModelId: string): SubagentModelResolution {
	if (inputModelId.startsWith("mistral/")) {
		return { provider: "mistral", modelId: inputModelId.slice("mistral/".length) };
	}

	if (inputModelId.startsWith("openai/") || inputModelId.startsWith("openai-codex/")) {
		const modelId = inputModelId.includes("/") ? inputModelId.split("/").slice(1).join("/") : inputModelId;
		return { provider: "openai-codex", modelId };
	}

	const mistralMatch = (getModels("mistral") as Model<any>[]).find((model) => model.id === inputModelId);
	if (mistralMatch) {
		return { provider: "mistral", modelId: inputModelId };
	}

	return { provider: "openai-codex", modelId: inputModelId };
}

export function resolveBackendModel(modelId: string): ResolvedSubagentModel | undefined {
	const normalized = normalizeModelSelection(modelId);
	const models = getModels(normalized.provider) as Model<any>[];
	const fromList = models.find((model) => model.id === normalized.modelId || model.id === modelId);
	if (fromList) {
		return { ...fromList, provider: normalized.provider } as ResolvedSubagentModel;
	}

	try {
		const model = getModel(normalized.provider, normalized.modelId as never) as Model<any>;
		return { ...model, provider: normalized.provider } as ResolvedSubagentModel;
	} catch {
		return undefined;
	}
}

export function resolveSubagentApiKey(provider: string, body: SubagentRunRequestBody, state: SubagentState): string {
	if (provider === "mistral") {
		return (body.mistralApiKey || state.mistralApiKey || "").trim();
	}
	if (provider === "openai-codex") {
		return (body.openAIAccessToken || "").trim();
	}
	throw new Error(`Unsupported provider '${provider}' for backend subagent execution.`);
}

export function extractPlainText(content: unknown): string {
	if (!Array.isArray(content)) {
		return "";
	}

	return content
		.map((part) => {
			if (!part || typeof part !== "object") {
				return "";
			}
			const typedPart = part as { type?: unknown; text?: unknown; thinking?: unknown; name?: unknown; arguments?: unknown };
			if (typedPart.type === "text" && typeof typedPart.text === "string") {
				return typedPart.text;
			}
			if (typedPart.type === "thinking" && typeof typedPart.thinking === "string") {
				return typedPart.thinking;
			}
			if (typedPart.type === "toolCall") {
				const name = typeof typedPart.name === "string" ? typedPart.name : "tool";
				const args = typeof typedPart.arguments === "string" ? typedPart.arguments : "";
				return `[tool:${name}] ${args}`.trim();
			}
			return "";
		})
		.filter((text) => text.length > 0)
		.join("\n");
}

export async function handleSubagentRunRequest(
	request: IncomingMessage,
	response: ServerResponse,
	rootDir: string,
	helper: SubagentHelpers,
): Promise<void> {
	const requestId = readRequestId(request.headers);
	let operationStartedAt = 0;
	const logRejected = (reason: string, agentId?: string): void => {
		logBackendEvent({
			event: "agent_operation",
			operation: "subagent_run",
			phase: "end",
			status: "rejected",
			reason,
			...(requestId ? { requestId } : {}),
			...(agentId ? { agentId } : {}),
		});
	};

	let body: SubagentRunRequestBody;
	try {
		body = validateSubagentRunBody(await helper.readJsonBody(request));
	} catch (error) {
		logRejected(error instanceof Error ? error.message : "invalid_body");
		helper.sendJson(response, 400, {
			error: error instanceof Error ? error.message : "Invalid subagent run request body.",
		});
		return;
	}

	const profile = await findOpencodeSubagentProfile(body.agentId, rootDir);
	if (!profile) {
		logRejected("unknown_profile", body.agentId);
		helper.sendJson(response, 400, { error: `Unknown subagent profile: ${body.agentId}` });
		return;
	}

	const resolvedModel = resolveBackendModel(profile.model);
	if (!resolvedModel) {
		logRejected("unknown_model", body.agentId);
		helper.sendJson(response, 500, { error: `Unable to resolve model for subagent profile '${body.agentId}' (${profile.model}).` });
		return;
	}

	const allowedTools = deriveAllowedToolsFromPermission(profile.permission);
	operationStartedAt = Date.now();
	logBackendEvent({
		event: "agent_operation",
		operation: "subagent_run",
		phase: "start",
		...(requestId ? { requestId } : {}),
		agentId: profile.id,
		modelId: resolvedModel.id,
		provider: resolvedModel.provider,
		thinkingLevel: body.thinkingLevel,
		allowedToolsCount: allowedTools.length,
	});

	await updateState((current) => ({
		...current,
		selection: {
			modelId: profile.model,
			agentId: profile.id,
			thinkingMode: typeof body.thinkingLevel === "string" ? body.thinkingLevel : current.selection.thinkingMode,
		},
	}));

	const state = await helper.readState();
	const apiKey = resolveSubagentApiKey(resolvedModel.provider, body, state);
	if (!apiKey) {
		logRejected("missing_api_key", body.agentId);
		helper.sendJson(response, 400, {
			error:
				resolvedModel.provider === "mistral"
					? "Missing Mistral API key. Provide mistralApiKey or save it in state settings."
					: "Missing OpenAI access token. Provide openAIAccessToken.",
		});
		return;
	}

	const flow: SubagentFlowEntry[] = [];
	flow.push({ role: "system", content: profile.prompt || "" });
	flow.push({ role: "user", content: body.task, timestamp: new Date().toISOString() });

	let status: "completed" | "failed" = "completed";
	let errorMessage: string | undefined;

	try {
		const stream = streamSimple(
			resolvedModel,
			{ systemPrompt: profile.prompt, messages: [{ role: "user", content: body.task, timestamp: Date.now() }] },
			{
				apiKey,
				reasoning: body.thinkingLevel,
				...(allowedTools.length > 0 ? ({ tools: allowedTools } as unknown as Record<string, unknown>) : {}),
			},
		);

		for await (const event of stream) {
			if (event.type === "done") {
				const assistantText = extractPlainText(event.message.content);
				flow.push({
					role: "assistant",
					content: assistantText,
					timestamp: new Date(event.message.timestamp).toISOString(),
				});
				continue;
			}

			if (event.type === "error") {
				status = "failed";
				errorMessage = event.error.errorMessage || "Subagent failed";
				const assistantText = extractPlainText(event.error.content);
				if (assistantText || errorMessage) {
					flow.push({
						role: "assistant",
						content: assistantText || errorMessage,
						timestamp: new Date(event.error.timestamp).toISOString(),
					});
				}
			}
		}
	} catch (error) {
		status = "failed";
		errorMessage = error instanceof Error ? error.message : "Subagent failed";
		flow.push({
			role: "assistant",
			content: errorMessage,
			timestamp: new Date().toISOString(),
		});
	}

	const summary =
		[...flow].reverse().find((entry) => entry.role === "assistant" && entry.content.trim().length > 0)?.content ||
		(status === "failed" ? "(subagent failed without textual output)" : "(empty response)");

	const payload: SubagentRunResponse = {
		agentId: profile.id,
		task: body.task,
		summary,
		status,
		errorMessage,
		flow,
	};

	logBackendEvent({
		event: "agent_operation",
		operation: "subagent_run",
		phase: "end",
		status,
		durationMs: Math.max(0, Date.now() - operationStartedAt),
		...(requestId ? { requestId } : {}),
		agentId: profile.id,
		modelId: resolvedModel.id,
		provider: resolvedModel.provider,
		flowEntries: flow.length,
		...(errorMessage ? { errorMessage } : {}),
	});

	helper.setNoStore(response);
	helper.sendJson(response, 200, payload);
}
