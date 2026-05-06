import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getModel, getModels, streamSimple } from "@mariozechner/pi-ai";
import type { AssistantMessageEvent, Context, Model, SimpleStreamOptions } from "@mariozechner/pi-ai";

type OpenAICodexCredentials = {
	access: string;
	refresh: string;
	expires: number;
	accountId: string;
};

type PersistedState = {
	mistralApiKey: string;
	openAICodexCredentials?: OpenAICodexCredentials;
	sessions: unknown[];
};

type ProxyEvent =
	| { type: "start" }
	| { type: "text_start"; contentIndex: number }
	| { type: "text_delta"; contentIndex: number; delta: string }
	| { type: "text_end"; contentIndex: number; contentSignature?: string }
	| { type: "thinking_start"; contentIndex: number }
	| { type: "thinking_delta"; contentIndex: number; delta: string }
	| { type: "thinking_end"; contentIndex: number; contentSignature?: string }
	| { type: "toolcall_start"; contentIndex: number; id: string; toolName: string }
	| { type: "toolcall_delta"; contentIndex: number; delta: string }
	| { type: "toolcall_end"; contentIndex: number }
	| { type: "done"; reason: "stop" | "length" | "toolUse"; usage: ReturnType<typeof emptyUsage> }
	| { type: "error"; reason: "aborted" | "error"; errorMessage: string; usage: ReturnType<typeof emptyUsage> };

type StreamRequestBody = {
	model: Model<any>;
	context: Context;
	options?: Pick<SimpleStreamOptions, "maxTokens" | "reasoning" | "sessionId" | "temperature" | "transport">;
};

type SubagentRunRequestBody = {
	agentId: string;
	task: string;
	mistralApiKey?: string;
	openAIAccessToken?: string;
	thinkingLevel?: string;
};

type SubagentFlowEntry = {
	role: string;
	content: string;
	timestamp?: string;
};

type SubagentRunResponse = {
	toolCallId?: string;
	agentId: string;
	task: string;
	summary: string;
	status: "completed" | "failed";
	errorMessage?: string;
	flow: SubagentFlowEntry[];
};

type OpencodeAgentProfile = {
	id: string;
	model: string;
	mode: "primary" | "subagent";
	prompt?: string;
};

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const REDIRECT_URI = "http://localhost:1455/auth/callback";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";
const MAX_JSON_BYTES = 25 * 1024 * 1024;
const ROOT_DIR = fileURLToPath(new URL("../", import.meta.url));
const DIST_DIR = join(ROOT_DIR, "dist");
const OPENCODE_CONFIG_FILE = resolve(ROOT_DIR, "../opencode.json");
const CACHE_DIR = join(ROOT_DIR, ".cache");
const STATE_FILE = join(CACHE_DIR, "state.json");
const DEFAULT_STATE: PersistedState = {
	mistralApiKey: "",
	openAICodexCredentials: undefined,
	sessions: [],
};

let writeQueue: Promise<PersistedState> = Promise.resolve({ ...DEFAULT_STATE });

const CONTENT_TYPES: Record<string, string> = {
	".css": "text/css; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".png": "image/png",
	".svg": "image/svg+xml",
	".txt": "text/plain; charset=utf-8",
	".webp": "image/webp",
	".woff": "font/woff",
	".woff2": "font/woff2",
};

createServer(async (request, response) => {
	setCorsHeaders(response);

	if (!request.url || !request.headers.host) {
		sendJson(response, 400, { error: "Invalid request." });
		return;
	}

	if (request.method === "OPTIONS") {
		response.writeHead(204);
		response.end();
		return;
	}

	const url = new URL(request.url, `http://${request.headers.host}`);

	try {
		if (request.method === "GET" && url.pathname === "/api/health") {
			sendJson(response, 200, { ok: true });
			return;
		}

		if (request.method === "GET" && url.pathname === "/api/state") {
			setNoStore(response);
			sendJson(response, 200, await readState());
			return;
		}

		if (request.method === "PUT" && url.pathname === "/api/state/settings") {
			await handleSettingsUpdate(request, response);
			return;
		}

		if (request.method === "PUT" && url.pathname === "/api/state/openai-codex-credentials") {
			await handleCredentialsUpdate(request, response);
			return;
		}

		if (request.method === "PUT" && url.pathname === "/api/state/sessions") {
			await handleSessionsUpdate(request, response);
			return;
		}

		if (request.method === "POST" && url.pathname === "/api/stream") {
			await handleStreamRequest(request, response);
			return;
		}

		if (request.method === "POST" && url.pathname === "/api/subagent/run") {
			await handleSubagentRunRequest(request, response);
			return;
		}

		if (request.method === "POST" && (url.pathname === "/api/ask-subagent" || url.pathname === "/ask-subagent")) {
			await handleSubagentRunRequest(request, response);
			return;
		}

		if (request.method === "POST" && url.pathname === "/api/openai-codex/oauth/exchange") {
			await handleOAuthExchange(request, response);
			return;
		}

		if (request.method === "POST" && url.pathname === "/api/openai-codex/oauth/refresh") {
			await handleOAuthRefresh(request, response);
			return;
		}

		if (request.method === "GET" || request.method === "HEAD") {
			await serveStaticAsset(url.pathname, response, request.method === "HEAD");
			return;
		}

		sendJson(response, 404, { error: "Not found." });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unexpected server error.";
		if (response.headersSent) {
			response.end();
			return;
		}
		sendJson(response, 500, { error: message });
	}
}).listen(PORT, HOST, () => {
	console.log(`API server listening on http://${HOST}:${PORT}`);
});

async function handleStreamRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
	const bearer = readBearerToken(request.headers.authorization);
	if (!bearer) {
		sendJson(response, 401, { error: "Missing Authorization bearer token." });
		return;
	}

	const body = validateStreamBody(await readJsonBody(request));
	const abortController = new AbortController();
	request.on("close", () => abortController.abort());

	response.writeHead(200, {
		"Cache-Control": "no-cache, no-transform",
		Connection: "keep-alive",
		"Content-Type": "text/event-stream; charset=utf-8",
	});
	response.write(": connected\n\n");

	try {
		const stream = streamSimple(body.model, body.context, {
			apiKey: bearer,
			maxTokens: body.options?.maxTokens,
			reasoning: body.options?.reasoning,
			sessionId: body.options?.sessionId,
			signal: abortController.signal,
			temperature: body.options?.temperature,
			transport: body.options?.transport,
		});

		for await (const event of stream) {
			response.write(`data: ${JSON.stringify(toProxyEvent(event))}\n\n`);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : "Proxy request failed.";
		response.write(
			`data: ${JSON.stringify({ type: "error", reason: abortController.signal.aborted ? "aborted" : "error", errorMessage: message, usage: emptyUsage() } satisfies ProxyEvent)}\n\n`,
		);
	} finally {
		response.end();
	}
}

async function handleOAuthExchange(request: IncomingMessage, response: ServerResponse): Promise<void> {
	const body = await readJsonBody(request);
	if (typeof body.code !== "string" || typeof body.codeVerifier !== "string") {
		sendJson(response, 400, { error: "code and codeVerifier are required." });
		return;
	}

	const credentials = await exchangeAuthorizationCode(body.code, body.codeVerifier);
	setNoStore(response);
	sendJson(response, 200, credentials);
}

async function handleSubagentRunRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
	let body: SubagentRunRequestBody;
	try {
		body = validateSubagentRunBody(await readJsonBody(request));
	} catch (error) {
		sendJson(response, 400, {
			error: error instanceof Error ? error.message : "Invalid subagent run request body.",
		});
		return;
	}

	const profile = await findOpencodeSubagentProfile(body.agentId);
	if (!profile) {
		sendJson(response, 400, { error: `Unknown subagent profile: ${body.agentId}` });
		return;
	}

	const resolvedModel = resolveBackendModel(profile.model);
	if (!resolvedModel) {
		sendJson(response, 500, { error: `Unable to resolve model for subagent profile '${body.agentId}' (${profile.model}).` });
		return;
	}

	const state = await readState();
	const apiKey = resolveSubagentApiKey(resolvedModel.provider, body, state);
	if (!apiKey) {
		sendJson(response, 400, {
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

	setNoStore(response);
	sendJson(response, 200, payload);
}

async function handleOAuthRefresh(request: IncomingMessage, response: ServerResponse): Promise<void> {
	const body = await readJsonBody(request);
	if (typeof body.refresh !== "string") {
		sendJson(response, 400, { error: "refresh is required." });
		return;
	}

	const credentials = await refreshCredentials(body.refresh);
	setNoStore(response);
	sendJson(response, 200, credentials);
}

async function handleSettingsUpdate(request: IncomingMessage, response: ServerResponse): Promise<void> {
	const body = await readJsonBody(request);
	if (typeof body.mistralApiKey !== "string") {
		sendJson(response, 400, { error: "mistralApiKey must be a string." });
		return;
	}
	const mistralApiKey = body.mistralApiKey;

	setNoStore(response);
	sendJson(response, 200, await updateState((current) => ({ ...current, mistralApiKey })));
}

async function handleCredentialsUpdate(request: IncomingMessage, response: ServerResponse): Promise<void> {
	const body = await readJsonBody(request);
	const credentials = body.openAICodexCredentials;
	if (credentials !== null && credentials !== undefined && !isCredentials(credentials)) {
		sendJson(response, 400, { error: "openAICodexCredentials must be valid credentials or null." });
		return;
	}

	setNoStore(response);
	sendJson(
		response,
		200,
		await updateState((current) => ({ ...current, openAICodexCredentials: credentials ?? undefined })),
	);
}

async function handleSessionsUpdate(request: IncomingMessage, response: ServerResponse): Promise<void> {
	const body = await readJsonBody(request);
	if (!Array.isArray(body.sessions)) {
		sendJson(response, 400, { error: "sessions must be an array." });
		return;
	}
	const sessions = body.sessions;

	setNoStore(response);
	sendJson(response, 200, await updateState((current) => ({ ...current, sessions })));
}

async function exchangeAuthorizationCode(code: string, codeVerifier: string): Promise<OpenAICodexCredentials> {
	const oauthResponse = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: CLIENT_ID,
			code,
			code_verifier: codeVerifier,
			redirect_uri: REDIRECT_URI,
		}),
	});

	return parseOAuthResponse(oauthResponse, "OpenAI token exchange failed");
}

async function refreshCredentials(refreshToken: string): Promise<OpenAICodexCredentials> {
	const oauthResponse = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: CLIENT_ID,
		}),
	});

	return parseOAuthResponse(oauthResponse, "OpenAI token refresh failed");
}

async function parseOAuthResponse(oauthResponse: Response, errorPrefix: string): Promise<OpenAICodexCredentials> {
	if (!oauthResponse.ok) {
		const text = await oauthResponse.text().catch(() => "");
		throw new Error(`${errorPrefix} (${oauthResponse.status}): ${text || oauthResponse.statusText}`);
	}

	const json = (await oauthResponse.json()) as {
		access_token?: string;
		refresh_token?: string;
		expires_in?: number;
	};
	if (
		typeof json.access_token !== "string" ||
		typeof json.refresh_token !== "string" ||
		typeof json.expires_in !== "number"
	) {
		throw new Error("OpenAI OAuth response was missing required fields.");
	}

	const accountId = extractAccountId(json.access_token);
	if (!accountId) {
		throw new Error("Could not extract OpenAI account ID from access token.");
	}

	return {
		access: json.access_token,
		refresh: json.refresh_token,
		expires: Date.now() + json.expires_in * 1000,
		accountId,
	};
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
	const parts = token.split(".");
	if (parts.length !== 3) {
		return null;
	}

	const payload = parts[1]?.replace(/-/g, "+").replace(/_/g, "/") || "";
	const pad = payload.length % 4;
	const normalizedPayload = payload + (pad ? "=".repeat(4 - pad) : "");

	try {
		return JSON.parse(Buffer.from(normalizedPayload, "base64").toString("utf8")) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function extractAccountId(accessToken: string): string | null {
	const payload = decodeJwtPayload(accessToken);
	if (!payload) {
		return null;
	}

	const authInfo = payload[JWT_CLAIM_PATH];
	if (!authInfo || typeof authInfo !== "object") {
		return null;
	}

	const accountId = (authInfo as { chatgpt_account_id?: unknown }).chatgpt_account_id;
	return typeof accountId === "string" && accountId.length > 0 ? accountId : null;
}

async function readState(): Promise<PersistedState> {
	try {
		const raw = await readFile(STATE_FILE, "utf8");
		return normalizeState(JSON.parse(raw));
	} catch {
		return { ...DEFAULT_STATE };
	}
}

async function updateState(updater: (current: PersistedState) => PersistedState | Promise<PersistedState>): Promise<PersistedState> {
	writeQueue = writeQueue.then(async () => {
		const current = await readState();
		const next = normalizeState(await updater(current));
		await mkdir(CACHE_DIR, { recursive: true });
		await writeFile(STATE_FILE, `${JSON.stringify(next, null, 2)}\n`, "utf8");
		return next;
	});
	return writeQueue;
}

function normalizeState(value: unknown): PersistedState {
	const next = value && typeof value === "object" ? (value as Partial<PersistedState>) : DEFAULT_STATE;
	return {
		mistralApiKey: typeof next.mistralApiKey === "string" ? next.mistralApiKey : DEFAULT_STATE.mistralApiKey,
		openAICodexCredentials: isCredentials(next.openAICodexCredentials) ? next.openAICodexCredentials : undefined,
		sessions: Array.isArray(next.sessions) ? next.sessions : DEFAULT_STATE.sessions,
	};
}

function isCredentials(value: unknown): value is OpenAICodexCredentials {
	return Boolean(
		value &&
			typeof value === "object" &&
			typeof (value as OpenAICodexCredentials).access === "string" &&
			typeof (value as OpenAICodexCredentials).refresh === "string" &&
			typeof (value as OpenAICodexCredentials).accountId === "string" &&
			typeof (value as OpenAICodexCredentials).expires === "number",
	);
}

function toProxyEvent(event: AssistantMessageEvent): ProxyEvent {
	switch (event.type) {
		case "start":
			return { type: "start" };
		case "text_start":
			return { type: "text_start", contentIndex: event.contentIndex };
		case "text_delta":
			return { type: "text_delta", contentIndex: event.contentIndex, delta: event.delta };
		case "text_end": {
			const block = event.partial.content[event.contentIndex];
			return {
				type: "text_end",
				contentIndex: event.contentIndex,
				contentSignature: block?.type === "text" ? block.textSignature : undefined,
			};
		}
		case "thinking_start":
			return { type: "thinking_start", contentIndex: event.contentIndex };
		case "thinking_delta":
			return { type: "thinking_delta", contentIndex: event.contentIndex, delta: event.delta };
		case "thinking_end": {
			const block = event.partial.content[event.contentIndex];
			return {
				type: "thinking_end",
				contentIndex: event.contentIndex,
				contentSignature: block?.type === "thinking" ? block.thinkingSignature : undefined,
			};
		}
		case "toolcall_start": {
			const block = event.partial.content[event.contentIndex];
			return {
				type: "toolcall_start",
				contentIndex: event.contentIndex,
				id: block?.type === "toolCall" ? block.id : "",
				toolName: block?.type === "toolCall" ? block.name : "",
			};
		}
		case "toolcall_delta":
			return { type: "toolcall_delta", contentIndex: event.contentIndex, delta: event.delta };
		case "toolcall_end":
			return { type: "toolcall_end", contentIndex: event.contentIndex };
		case "done":
			return { type: "done", reason: event.reason, usage: event.message.usage };
		case "error":
			return {
				type: "error",
				reason: event.reason,
				errorMessage: event.error.errorMessage || "Proxy request failed.",
				usage: event.error.usage,
			};
	}
}

function validateStreamBody(body: Record<string, unknown>): StreamRequestBody {
	if (!body.model || typeof body.model !== "object") {
		throw new Error("Stream payload is missing model.");
	}

	if (!body.context || typeof body.context !== "object") {
		throw new Error("Stream payload is missing context.");
	}

	return body as unknown as StreamRequestBody;
}

function validateSubagentRunBody(body: Record<string, unknown>): SubagentRunRequestBody {
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
		next.thinkingLevel = body.thinkingLevel;
	}

	return next;
}

async function findOpencodeSubagentProfile(agentId: string): Promise<OpencodeAgentProfile | undefined> {
	const config = JSON.parse(await readFile(OPENCODE_CONFIG_FILE, "utf8")) as {
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

	const subagents = Object.entries(config.agent).filter(
		([, def]) => def && typeof def === "object" && def.mode === "subagent",
	);
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

function resolveBackendModel(modelId: string): Model<any> | undefined {
	const normalized = normalizeModelSelection(modelId);
	const models = getModels(normalized.provider) as Model<any>[];
	const fromList = models.find((model) => model.id === normalized.modelId || model.id === modelId);
	if (fromList) {
		return fromList;
	}

	try {
		return getModel(normalized.provider, normalized.modelId as never) as Model<any>;
	} catch {
		return undefined;
	}
}

function normalizeModelSelection(inputModelId: string): { provider: "mistral" | "openai-codex"; modelId: string } {
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

function resolveSubagentApiKey(
	provider: string,
	body: SubagentRunRequestBody,
	state: PersistedState,
): string {
	if (provider === "mistral") {
		return (body.mistralApiKey || state.mistralApiKey || "").trim();
	}
	if (provider === "openai-codex") {
		return (body.openAIAccessToken || "").trim();
	}
	throw new Error(`Unsupported provider '${provider}' for backend subagent execution.`);
}

function extractPlainText(content: unknown): string {
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

function readBearerToken(header?: string): string {
	if (!header) {
		return "";
	}

	const match = /^Bearer\s+(.+)$/i.exec(header);
	return match?.[1]?.trim() || "";
}

function emptyUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	let totalBytes = 0;

	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		totalBytes += buffer.length;
		if (totalBytes > MAX_JSON_BYTES) {
			throw new Error(`Request body exceeded ${MAX_JSON_BYTES} bytes.`);
		}
		chunks.push(buffer);
	}

	if (chunks.length === 0) {
		return {};
	}

	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
	} catch {
		throw new Error("Request body must be valid JSON.");
	}
}

function setCorsHeaders(response: ServerResponse): void {
	response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
	response.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,PUT,OPTIONS");
	response.setHeader("Access-Control-Allow-Origin", "*");
}

function setNoStore(response: ServerResponse): void {
	response.setHeader("Cache-Control", "no-store");
	response.setHeader("Pragma", "no-cache");
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
	response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
	response.end(JSON.stringify(body));
}

async function serveStaticAsset(requestPath: string, response: ServerResponse, headOnly: boolean): Promise<void> {
	if (!existsSync(DIST_DIR)) {
		sendJson(response, 404, { error: "Frontend build not found. Run `vite build` first." });
		return;
	}

	const pathname = requestPath === "/" ? "/index.html" : requestPath;
	const safePath = normalize(pathname).replace(/^\.+/, "");
	let filePath = resolve(DIST_DIR, `.${safePath}`);

	if (!filePath.startsWith(DIST_DIR)) {
		sendJson(response, 403, { error: "Forbidden." });
		return;
	}

	let fileStat;
	try {
		fileStat = await stat(filePath);
		if (fileStat.isDirectory()) {
			filePath = join(filePath, "index.html");
			fileStat = await stat(filePath);
		}
	} catch {
		filePath = join(DIST_DIR, "index.html");
		fileStat = await stat(filePath);
	}

	const extension = extname(filePath);
	response.writeHead(200, {
		"Content-Length": fileStat.size,
		"Content-Type": CONTENT_TYPES[extension] || "application/octet-stream",
	});

	if (headOnly) {
		response.end();
		return;
	}

	createReadStream(filePath).pipe(response);
}
