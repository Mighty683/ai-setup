import type { OpenAICodexCredentials } from "~src/modules/chat/modules/agents/services/openaiCodexOAuth";
import type { StoredSession } from "~src/modules/chat/modules/sessions/domain/types";

export type PersistedServerState = {
	mistralApiKey: string;
	openAICodexCredentials?: OpenAICodexCredentials;
	sessions: StoredSession[];
};

export async function loadServerState(): Promise<PersistedServerState> {
	const response = await fetch("/api/state");
	if (!response.ok) {
		throw new Error(`Failed to load server state (${response.status}).`);
	}

	const json = (await response.json()) as Partial<PersistedServerState>;
	return {
		mistralApiKey: typeof json.mistralApiKey === "string" ? json.mistralApiKey : "",
		openAICodexCredentials: isOpenAICodexCredentials(json.openAICodexCredentials)
			? json.openAICodexCredentials
			: undefined,
		sessions: Array.isArray(json.sessions) ? json.sessions : [],
	};
}

export async function persistMistralApiKey(value: string): Promise<void> {
	await putJson("/api/state/settings", { mistralApiKey: value });
}

export async function persistOpenAICodexCredentials(credentials?: OpenAICodexCredentials): Promise<void> {
	await putJson("/api/state/openai-codex-credentials", {
		openAICodexCredentials: credentials ?? null,
	});
}

export async function persistSessions(sessions: StoredSession[]): Promise<void> {
	await putJson("/api/state/sessions", { sessions });
}

export function flushSessionsBestEffort(sessions: StoredSession[]): void {
	const payload = JSON.stringify({ sessions });

	if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
		const blob = new Blob([payload], { type: "application/json" });
		navigator.sendBeacon("/api/state/sessions", blob);
		return;
	}

	if (typeof fetch !== "function") {
		return;
	}

	void fetch("/api/state/sessions", {
		method: "PUT",
		headers: {
			"Content-Type": "application/json",
		},
		body: payload,
		keepalive: true,
	});
}

async function putJson(url: string, body: unknown): Promise<void> {
	const response = await fetch(url, {
		method: "PUT",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(`Failed to save server state (${response.status}): ${text || response.statusText}`);
	}
}

function isOpenAICodexCredentials(value: unknown): value is OpenAICodexCredentials {
	if (!value || typeof value !== "object") {
		return false;
	}

	const parsed = value as Partial<OpenAICodexCredentials>;
	return (
		typeof parsed.access === "string" &&
		typeof parsed.refresh === "string" &&
		typeof parsed.accountId === "string" &&
		typeof parsed.expires === "number"
	);
}
