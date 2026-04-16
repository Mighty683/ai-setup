import type { AgentMessage, ThinkingLevel } from "@mariozechner/pi-agent-core";

export type StoredSession = {
	id: string;
	title: string;
	modelId: string;
	thinkingLevel: ThinkingLevel;
	messages: AgentMessage[];
	createdAt: string;
	lastModified: string;
};
