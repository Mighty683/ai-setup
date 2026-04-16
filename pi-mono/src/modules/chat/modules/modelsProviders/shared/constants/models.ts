import type { ThinkingLevel } from "@mariozechner/pi-agent-core";

export const DEFAULT_PROVIDER = "mistral";
export const AVAILABLE_PROVIDERS = [DEFAULT_PROVIDER, "openai-codex"] as const;

export const DEFAULT_MODEL_ID = import.meta.env.VITE_DEFAULT_MODEL || "mistral.magistral-small-2509";

export const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
