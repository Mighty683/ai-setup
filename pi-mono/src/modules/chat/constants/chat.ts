import type { ThinkingLevel } from "@mariozechner/pi-agent-core";

export const SESSIONS_KEY = "pi-mono-vue-sessions-v1";
export const API_KEY_KEY = "pi-mono-mistral-api-key";

export const DEFAULT_PROVIDER = "mistral";
export const AVAILABLE_PROVIDERS = [DEFAULT_PROVIDER] as const;

export const DEFAULT_MODEL_ID = import.meta.env.VITE_DEFAULT_MODEL || "mistral.magistral-small-2509";

export const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

export const DEFAULT_SYSTEM_PROMPT =
	"You are a helpful AI assistant. Keep answers grounded, concise, and practical.";
