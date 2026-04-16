import type { Agent, AgentState, ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Ref } from "vue";
import { resolveModel, type SupportedProvider } from "~src/modules/chat/api/agent";
import { SESSIONS_KEY } from "~src/modules/chat/constants/chat";
import { providerFromModelId } from "~src/modules/chat/composables/useChatController/modelsProviders";
import { updateSessionParam } from "~src/modules/chat/composables/useChatController/storage";
import {
	createStoredSession,
	findSessionById,
	getOrCreateSessionCreatedAt,
	indexCreatedAtBySessionId,
} from "~src/modules/chat/composables/useChatController/userSessions";
import {
	generateTitle,
	loadStoredSessions,
	saveStoredSessions,
	shouldPersistSession,
	upsertSession,
} from "~src/modules/chat/helpers/sessions";
import type { StoredSession } from "~src/modules/chat/types/chat";

type CreateSessionActionsOptions = {
	getAgent: () => Agent | undefined;
	createAgent: (initialState?: Partial<AgentState>) => Promise<void>;
	currentSessionId: Ref<string | undefined>;
	currentTitle: Ref<string>;
	selectedProvider: Ref<SupportedProvider>;
	selectedModelId: Ref<string>;
	selectedThinkingLevel: Ref<ThinkingLevel>;
	sessions: Ref<StoredSession[]>;
	showSessions: Ref<boolean>;
	getCreatedAtBySessionId: () => Map<string, string>;
	setCreatedAtBySessionId: (value: Map<string, string>) => void;
};

export function createSessionActions(options: CreateSessionActionsOptions) {
	function persistSessions(nextSessions: StoredSession[]) {
		options.sessions.value = saveStoredSessions(SESSIONS_KEY, nextSessions);
	}

	function initializeStoredSessions() {
		options.sessions.value = loadStoredSessions(SESSIONS_KEY);
		options.setCreatedAtBySessionId(indexCreatedAtBySessionId(options.sessions.value));
	}

	function persistCurrentSession() {
		const agent = options.getAgent();
		if (!agent || !shouldPersistSession(agent.state.messages)) {
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
			title: options.currentTitle.value || generateTitle(agent.state.messages),
			modelId: agent.state.model?.id || options.selectedModelId.value,
			thinkingLevel: agent.state.thinkingLevel,
			messages: agent.state.messages,
			createdAt,
		});

		if (!options.currentTitle.value) {
			options.currentTitle.value = storedSession.title;
		}

		persistSessions(upsertSession(options.sessions.value, storedSession));
	}

	async function loadSession(sessionId: string) {
		const session = findSessionById(options.sessions.value, sessionId);
		if (!session) {
			return;
		}

		options.getCreatedAtBySessionId().set(session.id, session.createdAt);
		options.currentSessionId.value = session.id;
		options.currentTitle.value = session.title;
		options.selectedProvider.value = providerFromModelId(session.modelId);
		options.selectedModelId.value = session.modelId;
		options.selectedThinkingLevel.value = session.thinkingLevel;
		updateSessionParam(session.id);

		await options.createAgent({
			model: resolveModel(session.modelId),
			thinkingLevel: session.thinkingLevel,
			messages: session.messages,
			tools: [],
		});

		options.showSessions.value = false;
	}

	async function startNewSession() {
		options.currentSessionId.value = undefined;
		options.currentTitle.value = "";
		updateSessionParam(undefined);
		await options.createAgent({
			messages: [],
			thinkingLevel: options.selectedThinkingLevel.value,
			model: resolveModel(options.selectedModelId.value),
			tools: [],
		});
	}

	function removeSession(sessionId: string) {
		const filtered = options.sessions.value.filter((session) => session.id !== sessionId);
		persistSessions(filtered);
		options.getCreatedAtBySessionId().delete(sessionId);

		if (sessionId === options.currentSessionId.value) {
			void startNewSession();
		}
	}

	return {
		initializeStoredSessions,
		persistCurrentSession,
		loadSession,
		startNewSession,
		removeSession,
	};
}
