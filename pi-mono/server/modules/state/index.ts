import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { ROOT_DIR, readJsonBody, sendJson, setNoStore } from "../common/index.js";
import type { ClientPersistedState, OpenAICodexCredentials, PersistedState, UserSelectionState } from "./types.js";

export const DEFAULT_AGENT_ID = "default";

export const CACHE_DIR = join(ROOT_DIR, ".cache");
export const STATE_FILE = join(CACHE_DIR, "state.json");

export const DEFAULT_STATE: PersistedState = {
	mistralApiKey: "",
	openAICodexCredentials: undefined,
	sessions: [],
	selection: {
		modelId: "",
		agentId: DEFAULT_AGENT_ID,
		thinkingMode: "",
	},
};

let writeQueue: Promise<PersistedState> = Promise.resolve({ ...DEFAULT_STATE });

export async function readState(): Promise<PersistedState> {
	try {
		const raw = await readFile(STATE_FILE, "utf8");
		return normalizeState(JSON.parse(raw));
	} catch {
		return { ...DEFAULT_STATE };
	}
}

export async function readClientState(): Promise<ClientPersistedState> {
	return toClientState(await readState());
}

export async function updateState(
	updater: (current: PersistedState) => PersistedState | Promise<PersistedState>,
): Promise<PersistedState> {
	writeQueue = writeQueue.then(async () => {
		const current = await readState();
		const next = normalizeState(await updater(current));
		await mkdir(CACHE_DIR, { recursive: true });
		await writeFile(STATE_FILE, `${JSON.stringify(next, null, 2)}\n`, "utf8");
		return next;
	});
	return writeQueue;
}

export function normalizeState(value: unknown): PersistedState {
	const next = value && typeof value === "object" ? (value as Partial<PersistedState>) : DEFAULT_STATE;
	return {
		mistralApiKey: typeof next.mistralApiKey === "string" ? next.mistralApiKey : DEFAULT_STATE.mistralApiKey,
		openAICodexCredentials: isCredentials(next.openAICodexCredentials) ? next.openAICodexCredentials : undefined,
		sessions: Array.isArray(next.sessions) ? next.sessions : DEFAULT_STATE.sessions,
		selection: normalizeSelectionState(next.selection),
	};
}

export function normalizeSelectionState(value: unknown): UserSelectionState {
	if (!value || typeof value !== "object") {
		return { ...DEFAULT_STATE.selection };
	}

	const next = value as Partial<UserSelectionState>;
	return {
		modelId: typeof next.modelId === "string" ? next.modelId : DEFAULT_STATE.selection.modelId,
		agentId: typeof next.agentId === "string" && next.agentId.trim().length > 0 ? next.agentId : DEFAULT_STATE.selection.agentId,
		thinkingMode: typeof next.thinkingMode === "string" ? next.thinkingMode : DEFAULT_STATE.selection.thinkingMode,
	};
}

export function isCredentials(value: unknown): value is OpenAICodexCredentials {
	return Boolean(
		value &&
			typeof value === "object" &&
			typeof (value as OpenAICodexCredentials).access === "string" &&
			typeof (value as OpenAICodexCredentials).refresh === "string" &&
			typeof (value as OpenAICodexCredentials).accountId === "string" &&
			typeof (value as OpenAICodexCredentials).expires === "number",
	);
}

export function toClientState(state: PersistedState): ClientPersistedState {
	return {
		mistralApiKey: state.mistralApiKey,
		openAICodexCredentials: state.openAICodexCredentials
			? {
				expires: state.openAICodexCredentials.expires,
				accountId: state.openAICodexCredentials.accountId,
			}
			: undefined,
		sessions: state.sessions,
		selection: state.selection,
	};
}

export async function handleSettingsUpdate(request: IncomingMessage, response: ServerResponse): Promise<void> {
	const body = await readJsonBody(request);
	if (typeof body.mistralApiKey !== "string") {
		sendJson(response, 400, { error: "mistralApiKey must be a string." });
		return;
	}
	const mistralApiKey = body.mistralApiKey;

	setNoStore(response);
	sendJson(response, 200, await updateState((current) => ({ ...current, mistralApiKey })));
}

export async function handleCredentialsUpdate(request: IncomingMessage, response: ServerResponse): Promise<void> {
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

export async function handleSessionsUpdate(request: IncomingMessage, response: ServerResponse): Promise<void> {
	const body = await readJsonBody(request);
	if (!Array.isArray(body.sessions)) {
		sendJson(response, 400, { error: "sessions must be an array." });
		return;
	}
	const sessions = body.sessions;

	setNoStore(response);
	sendJson(response, 200, await updateState((current) => ({ ...current, sessions })));
}

export async function handleSelectionUpdate(request: IncomingMessage, response: ServerResponse): Promise<void> {
	const body = await readJsonBody(request);
	const rawSelection = body.selection;
	if (!rawSelection || typeof rawSelection !== "object") {
		sendJson(response, 400, { error: "selection must be an object." });
		return;
	}

	setNoStore(response);
	sendJson(
		response,
		200,
		await updateState((current) => ({
			...current,
			selection: normalizeSelectionState({ ...current.selection, ...(rawSelection as Record<string, unknown>) }),
		})),
	);
}

export type { ClientPersistedState, OpenAICodexCredentials, PersistedState, UserSelectionState };
