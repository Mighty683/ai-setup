import type { ChatMessage, ThinkingLevel } from "~src/modules/chat/modules/chat/shared/types/chat";
import type { StoredSession } from "~src/modules/chat/modules/sessions/domain/types";

type CreateStoredSessionInput = {
	id: string;
	title: string;
	modelId: string;
	opencodeAgentId?: string;
	thinkingLevel: ThinkingLevel;
	messages: ChatMessage[];
	createdAt: string;
};

export function indexCreatedAtBySessionId(storedSessions: StoredSession[]): Map<string, string> {
	const createdAtBySessionId = new Map<string, string>();
	for (const session of storedSessions) {
		createdAtBySessionId.set(session.id, session.createdAt);
	}
	return createdAtBySessionId;
}

export function getOrCreateSessionCreatedAt(createdAtBySessionId: Map<string, string>, sessionId: string): string {
	const existing = createdAtBySessionId.get(sessionId);
	if (existing) {
		return existing;
	}

	const createdAt = new Date().toISOString();
	createdAtBySessionId.set(sessionId, createdAt);
	return createdAt;
}

export function createStoredSession(input: CreateStoredSessionInput): StoredSession {
	return {
		id: input.id,
		title: input.title,
		modelId: input.modelId,
		opencodeAgentId: input.opencodeAgentId,
		thinkingLevel: input.thinkingLevel,
		messages: [...input.messages],
		createdAt: input.createdAt,
		lastModified: new Date().toISOString(),
	};
}

export function findSessionById(storedSessions: StoredSession[], sessionId: string): StoredSession | undefined {
	return storedSessions.find((session) => session.id === sessionId);
}
