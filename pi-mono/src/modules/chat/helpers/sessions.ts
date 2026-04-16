import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { extractPlainText } from "~src/core/chat/utils/custom-messages";
import type { StoredSession } from "~src/modules/chat/types/chat";

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

export function generateTitle(agentMessages: AgentMessage[]): string {
	const firstUserMessage = agentMessages.find((message) => message.role === "user");
	if (!firstUserMessage || firstUserMessage.role !== "user") {
		return "Untitled chat";
	}

	const text = extractPlainText(firstUserMessage.content).trim();
	if (!text) {
		return "Untitled chat";
	}

	const sentenceEnd = text.search(/[.!?]/);
	if (sentenceEnd > 0 && sentenceEnd <= 56) {
		return text.slice(0, sentenceEnd + 1);
	}

	return text.length <= 56 ? text : `${text.slice(0, 53)}...`;
}

export function shouldPersistSession(agentMessages: AgentMessage[]): boolean {
	const hasUserMessage = agentMessages.some((message) => message.role === "user");
	const hasAssistantMessage = agentMessages.some((message) => message.role === "assistant");
	return hasUserMessage && hasAssistantMessage;
}
