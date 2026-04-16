import { API_KEY_KEY } from "~src/modules/chat/constants/chat";

export function getStoredMistralApiKey(): string {
	return localStorage.getItem(API_KEY_KEY) || import.meta.env.VITE_MISTRAL_API_KEY || "";
}

export function persistMistralApiKey(value: string): void {
	localStorage.setItem(API_KEY_KEY, value);
}

export function updateSessionParam(sessionId?: string): void {
	const url = new URL(window.location.href);
	if (sessionId) {
		url.searchParams.set("session", sessionId);
	} else {
		url.searchParams.delete("session");
	}
	window.history.replaceState({}, "", url.toString());
}
