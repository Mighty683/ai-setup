import type { ThinkingLevel } from "~src/modules/chat/modules/chat/shared/types/chat";

export type ServerAgentCatalogEntry = {
	id: string;
	model: string;
	mode: "primary" | "subagent";
	role: string;
	prompt: string;
};

export type ServerCatalog = {
	agents: ServerAgentCatalogEntry[];
	models: string[];
	providers: string[];
	defaultAgentId: string;
	defaultModelId: string;
	thinkingLevels: ThinkingLevel[];
};

export async function loadServerCatalog(): Promise<ServerCatalog> {
	const response = await fetch("/api/catalog");
	if (!response.ok) {
		throw new Error(`Failed to load server catalog (${response.status}).`);
	}

	const json = (await response.json()) as Partial<ServerCatalog>;
	return {
		agents: Array.isArray(json.agents) ? json.agents : [],
		models: Array.isArray(json.models) ? json.models.filter((value): value is string => typeof value === "string") : [],
		providers: Array.isArray(json.providers) ? json.providers.filter((value): value is string => typeof value === "string") : [],
		defaultAgentId: typeof json.defaultAgentId === "string" ? json.defaultAgentId : "default",
		defaultModelId: typeof json.defaultModelId === "string" ? json.defaultModelId : "",
		thinkingLevels: Array.isArray(json.thinkingLevels)
			? json.thinkingLevels.filter((value): value is ThinkingLevel => typeof value === "string")
			: ["off", "minimal", "low", "medium", "high", "xhigh"],
	};
}
