import type { Ref } from "vue";

import { persistSessions as persistSessionsToServer } from "~src/modules/chat/modules/persistence/services/serverState";
import { updateSessionParam } from "~src/modules/chat/modules/sessions/shared/storage/sessionParam";
import {
	createStoredSession,
	findSessionById,
	getOrCreateSessionCreatedAt,
	indexCreatedAtBySessionId,
} from "~src/modules/chat/modules/sessions/composables/userSessions";
import {
	loadStoredSessions,
	saveStoredSessions,
	shouldPersistSession,
	upsertSession,
} from "~src/modules/chat/modules/sessions/domain/helpers";
import type { StoredSession } from "~src/modules/chat/modules/sessions/domain/types";
import { generateTitle } from "~src/modules/chat/modules/titleGeneration/domain/title";
import type { ChatMessage, ThinkingLevel } from "~src/modules/chat/modules/chat/shared/types/chat";

type CreateSessionActionsOptions = {
	currentSessionId: Ref<string | undefined>;
	currentTitle: Ref<string>;
	selectedProvider: Ref<string>;
	selectedModelId: Ref<string>;
	selectedOpencodeAgentId: Ref<string | undefined>;
	selectedThinkingLevel: Ref<ThinkingLevel>;
	messages: Ref<ChatMessage[]>;
	sessions: Ref<StoredSession[]>;
	showSessions: Ref<boolean>;
	getCreatedAtBySessionId: () => Map<string, string>;
	setCreatedAtBySessionId: (value: Map<string, string>) => void;
	loadPersistedSessions: () => StoredSession[];
	flushPersistedSessions: (sessions: StoredSession[]) => void;
	providerFromModelId: (modelId: string) => string;
};

export function createSessionActions(options: CreateSessionActionsOptions) {
	let persistQueue: Promise<void> = Promise.resolve();
	let latestPersistedSessions: StoredSession[] = [];

	async function persistSessions(nextSessions: StoredSession[]) {
		const sessionsToPersist = saveStoredSessions(nextSessions);
		options.sessions.value = sessionsToPersist;
		latestPersistedSessions = sessionsToPersist;

		const write = async () => {
			await persistSessionsToServer(sessionsToPersist);
		};

		persistQueue = persistQueue.then(write, write);
		await persistQueue;
	}

	function initializeStoredSessions() {
		options.sessions.value = loadStoredSessions(options.loadPersistedSessions());
		latestPersistedSessions = options.sessions.value;
		options.setCreatedAtBySessionId(indexCreatedAtBySessionId(options.sessions.value));
	}

	function flushPersistedSessions() {
		options.flushPersistedSessions(latestPersistedSessions);
	}

	async function persistCurrentSession() {
		if (!shouldPersistSession(options.messages.value)) {
			return;
		}

		if (!options.currentSessionId.value) {
			options.currentSessionId.value = crypto.randomUUID();
			updateSessionParam(options.currentSessionId.value);
		}

		const id = options.currentSessionId.value;
		if (!id) {
			return;
		}

		const createdAt = getOrCreateSessionCreatedAt(options.getCreatedAtBySessionId(), id);
		const storedSession = createStoredSession({
			id,
			title: options.currentTitle.value || generateTitle(options.messages.value),
			modelId: options.selectedModelId.value,
			opencodeAgentId: options.selectedOpencodeAgentId.value,
			thinkingLevel: options.selectedThinkingLevel.value,
			messages: options.messages.value,
			createdAt,
		});

		if (!options.currentTitle.value) {
			options.currentTitle.value = storedSession.title;
		}

		await persistSessions(upsertSession(options.sessions.value, storedSession));
	}

	async function loadSession(sessionId: string): Promise<boolean> {
		const session = findSessionById(options.sessions.value, sessionId);
		if (!session) {
			return false;
		}

		options.getCreatedAtBySessionId().set(session.id, session.createdAt);
		options.currentSessionId.value = session.id;
		options.currentTitle.value = session.title;
		options.selectedProvider.value = options.providerFromModelId(session.modelId);
		options.selectedModelId.value = session.modelId;
		options.selectedOpencodeAgentId.value = session.opencodeAgentId;
		options.selectedThinkingLevel.value = session.thinkingLevel;
		options.messages.value = session.messages;
		updateSessionParam(session.id);

		options.showSessions.value = false;
		return true;
	}

	async function startNewSession() {
		options.currentSessionId.value = undefined;
		options.currentTitle.value = "";
		options.messages.value = [];
		updateSessionParam(undefined);
	}

	function removeSession(sessionId: string) {
		const filtered = options.sessions.value.filter((session) => session.id !== sessionId);
		void persistSessions(filtered);
		options.getCreatedAtBySessionId().delete(sessionId);

		if (sessionId === options.currentSessionId.value) {
			void startNewSession();
		}
	}

	return {
		initializeStoredSessions,
		persistCurrentSession,
		flushPersistedSessions,
		loadSession,
		startNewSession,
		removeSession,
	};
}
