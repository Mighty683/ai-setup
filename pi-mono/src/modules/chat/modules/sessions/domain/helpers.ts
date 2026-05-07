import type { ChatMessage } from "~src/modules/chat/modules/chat/shared/types/chat";
import type { StoredSession } from "~src/modules/chat/modules/sessions/domain/types";

function sortByLastModifiedDesc(data: StoredSession[]): StoredSession[] {
	return [...data].sort((a, b) => b.lastModified.localeCompare(a.lastModified));
}

export function loadStoredSessions(data: StoredSession[]): StoredSession[] {
	return sortByLastModifiedDesc(data);
}

export function saveStoredSessions(data: StoredSession[]): StoredSession[] {
	return sortByLastModifiedDesc(data);
}

export function upsertSession(existing: StoredSession[], nextSession: StoredSession): StoredSession[] {
	const rest = existing.filter((session) => session.id !== nextSession.id);
	return sortByLastModifiedDesc([nextSession, ...rest]);
}

export function shouldPersistSession(agentMessages: ChatMessage[]): boolean {
	const hasUserMessage = agentMessages.some((message) => message.role === "user");
	const hasAssistantMessage = agentMessages.some((message) => message.role === "assistant");
	return hasUserMessage && hasAssistantMessage;
}
