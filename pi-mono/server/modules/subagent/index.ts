import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { getModel, getModels, streamSimple } from "@mariozechner/pi-ai";
import type { Model } from "@mariozechner/pi-ai";
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
	const opencodeConfigFile = resolve(rootDir, "../opencode.json");
	const config = JSON.parse(await readFile(opencodeConfigFile, "utf8")) as {
		agent?: Record<string, { model?: unknown; mode?: unknown; prompt?: unknown }>;
	};
	if (!config.agent || typeof config.agent !== "object") {
		throw new Error("opencode.json is missing an agent section.");
	}

	if (agentId !== "default" && agentId !== "private") {
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
		};
	}

	const subagents = Object.entries(config.agent).filter(([, def]) => def && typeof def === "object" && def.mode === "subagent");
	if (subagents.length === 0) {
		return undefined;
	}

	const [id, definition] = subagents[0];
	const typedDef = definition as { model?: unknown; mode?: unknown; prompt?: unknown };
	if (typeof typedDef.model !== "string" || typedDef.model.length === 0) {
		throw new Error(`Agent profile '${id}' is missing a valid model.`);
	}

	return {
		id,
		model: typedDef.model as string,
		mode: "subagent",
		prompt: typeof typedDef.prompt === "string" ? typedDef.prompt : "",
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
	let body: SubagentRunRequestBody;
	try {
		body = validateSubagentRunBody(await helper.readJsonBody(request));
	} catch (error) {
		helper.sendJson(response, 400, {
			error: error instanceof Error ? error.message : "Invalid subagent run request body.",
		});
		return;
	}

	const profile = await findOpencodeSubagentProfile(body.agentId, rootDir);
	if (!profile) {
		helper.sendJson(response, 400, { error: `Unknown subagent profile: ${body.agentId}` });
		return;
	}

	const resolvedModel = resolveBackendModel(profile.model);
	if (!resolvedModel) {
		helper.sendJson(response, 500, { error: `Unable to resolve model for subagent profile '${body.agentId}' (${profile.model}).` });
		return;
	}

	const state = await helper.readState();
	const apiKey = resolveSubagentApiKey(resolvedModel.provider, body, state);
	if (!apiKey) {
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
			{ systemPrompt: profile.prompt, messages: [{ role: "user", content: body.task }] },
			{
				apiKey,
				reasoning: body.thinkingLevel,
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

	helper.setNoStore(response);
	helper.sendJson(response, 200, payload);
}
