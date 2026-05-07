import type { ChatMessage, ThinkingLevel } from "~src/modules/chat/modules/chat/shared/types/chat";

export type StoredSession = {
	id: string;
	title: string;
	modelId: string;
	opencodeAgentId?: string;
	thinkingLevel: ThinkingLevel;
	messages: ChatMessage[];
	createdAt: string;
	lastModified: string;
};
