import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { streamSimple } from "@mariozechner/pi-ai";
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

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const REDIRECT_URI = "http://localhost:1455/auth/callback";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";
const MAX_JSON_BYTES = 25 * 1024 * 1024;
const ROOT_DIR = fileURLToPath(new URL("../", import.meta.url));
const DIST_DIR = join(ROOT_DIR, "dist");
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
