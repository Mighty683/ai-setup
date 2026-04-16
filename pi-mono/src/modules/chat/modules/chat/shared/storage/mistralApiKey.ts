import { API_KEY_KEY } from "~src/modules/chat/modules/chat/shared/constants/storage";

export function getStoredMistralApiKey(): string {
	return localStorage.getItem(API_KEY_KEY) || import.meta.env.VITE_MISTRAL_API_KEY || "";
}

export function persistMistralApiKey(value: string): void {
	localStorage.setItem(API_KEY_KEY, value);
}
