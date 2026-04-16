import type { AgentMessage, ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { ImageContent } from "@mariozechner/pi-ai";

export type StoredSession = {
	id: string;
	title: string;
	modelId: string;
	thinkingLevel: ThinkingLevel;
	messages: AgentMessage[];
	createdAt: string;
	lastModified: string;
};

export type PendingImage = ImageContent & {
	id: string;
	name: string;
	previewUrl: string;
};
