import { OPENAI_CODEX_CREDENTIALS_KEY } from "~src/modules/chat/modules/agents/shared/constants/storage";
import type { OpenAICodexCredentials } from "~src/modules/chat/modules/agents/services/openaiCodexOAuth";

export function getStoredOpenAICodexCredentials(): OpenAICodexCredentials | undefined {
	const raw = localStorage.getItem(OPENAI_CODEX_CREDENTIALS_KEY);
	if (!raw) {
		return undefined;
	}

	try {
		const parsed = JSON.parse(raw) as Partial<OpenAICodexCredentials>;
		if (
			typeof parsed.access === "string" &&
			typeof parsed.refresh === "string" &&
			typeof parsed.accountId === "string" &&
			typeof parsed.expires === "number"
		) {
			return {
				access: parsed.access,
				refresh: parsed.refresh,
				expires: parsed.expires,
				accountId: parsed.accountId,
			};
		}
	} catch {
		// noop
	}

	localStorage.removeItem(OPENAI_CODEX_CREDENTIALS_KEY);
	return undefined;
}

export function persistOpenAICodexCredentials(credentials?: OpenAICodexCredentials): void {
	if (!credentials) {
		localStorage.removeItem(OPENAI_CODEX_CREDENTIALS_KEY);
		return;
	}

	localStorage.setItem(OPENAI_CODEX_CREDENTIALS_KEY, JSON.stringify(credentials));
}
