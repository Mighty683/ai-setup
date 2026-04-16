import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { StoredSession } from "~src/modules/chat/modules/sessions/domain/types";

function sortByLastModifiedDesc(data: StoredSession[]): StoredSession[] {
	return [...data].sort((a, b) => b.lastModified.localeCompare(a.lastModified));
}

export function loadStoredSessions(storageKey: string): StoredSession[] {
	try {
		const raw = localStorage.getItem(storageKey);
		if (!raw) {
			return [];
		}
		const parsed = JSON.parse(raw) as StoredSession[];
		return sortByLastModifiedDesc(parsed);
	} catch {
		return [];
	}
}

export function saveStoredSessions(storageKey: string, data: StoredSession[]): StoredSession[] {
	const sorted = sortByLastModifiedDesc(data);
	localStorage.setItem(storageKey, JSON.stringify(sorted));
	return sorted;
}

export function upsertSession(existing: StoredSession[], nextSession: StoredSession): StoredSession[] {
	const rest = existing.filter((session) => session.id !== nextSession.id);
	return sortByLastModifiedDesc([nextSession, ...rest]);
}

export function shouldPersistSession(agentMessages: AgentMessage[]): boolean {
	const hasUserMessage = agentMessages.some((message) => message.role === "user");
	const hasAssistantMessage = agentMessages.some((message) => message.role === "assistant");
	return hasUserMessage && hasAssistantMessage;
}
