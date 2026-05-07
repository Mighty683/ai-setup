import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import type { PendingImage, ChatMessage, ThinkingLevel } from "~src/modules/chat/modules/chat/shared/types/chat";
import { createSystemNotification } from "~src/modules/chat/modules/chat/shared/utils/custom-messages";
import { createComposerActions } from "~src/modules/chat/modules/chat/composables/composerActions";
import { createSessionActions } from "~src/modules/chat/modules/sessions/composables/sessionActions";
import type { StoredSession } from "~src/modules/chat/modules/sessions/domain/types";
import { shouldPersistSession } from "~src/modules/chat/modules/sessions/domain/helpers";
import {
	flushSessionsBestEffort,
	loadServerState,
	type OpenAICodexCredentialStatus,
	persistMistralApiKey,
	persistOpenAICodexCredentials,
	persistSelection,
} from "~src/modules/chat/modules/persistence/services/serverState";
import { loadServerCatalog, type ServerAgentCatalogEntry } from "~src/modules/chat/modules/persistence/services/serverCatalog";
import { createTitleEditor } from "~src/modules/chat/modules/titleGeneration/composables/titleEditor";
import { generateTitle } from "~src/modules/chat/modules/titleGeneration/domain/title";
import { loginOpenAICodexByBrowser } from "~src/modules/chat/modules/agents/services/openaiCodexOAuth";
import { providerFromModelId } from "~src/modules/chat/modules/modelsProviders/composables/modelsProviders";

export function useChatController() {
	const currentSessionId = ref<string | undefined>();
	const currentTitle = ref("");
	const isEditingTitle = ref(false);
	const editableTitle = ref("");

	const showSessions = ref(false);
	const showSettings = ref(false);

	const sessions = ref<StoredSession[]>([]);
	const composerText = ref("");
	const mistralApiKey = ref("");
	const openAICodexCredentials = ref<OpenAICodexCredentialStatus | undefined>();
	const availableProviders = ref<string[]>([]);
	const thinkingLevels = ref<ThinkingLevel[]>(["off", "minimal", "low", "medium", "high", "xhigh"]);
	const opencodeAgents = ref<ServerAgentCatalogEntry[]>([]);
	const opencodeModels = ref<string[]>([]);
	const selectedProvider = ref("mistral");
	const selectedModelId = ref("");
	const selectedThinkingLevel = ref<ThinkingLevel>("off");
	const selectedOpencodeAgentId = ref<string | undefined>("default");
	const persistedSessions = ref<StoredSession[]>([]);

	const messages = ref<ChatMessage[]>([]);
	const isStreaming = ref(false);
	const errorMessage = ref<string | undefined>();
	const pendingImages = ref<PendingImage[]>([]);

	let createdAtBySessionId = new Map<string, string>();

	const hasMessages = computed(() => messages.value.length > 0);
	const models = computed(() => opencodeModels.value.map((id) => ({ id })));
	const hasOpenAICodexLogin = computed(() => Boolean(openAICodexCredentials.value));
	const agentReady = computed(() => opencodeAgents.value.length > 0 && selectedModelId.value.trim().length > 0);

	const {
		initializeStoredSessions,
		persistCurrentSession,
		flushPersistedSessions,
		loadSession,
		startNewSession,
		removeSession,
	} = createSessionActions({
		currentSessionId,
		currentTitle,
		selectedProvider,
		selectedModelId,
		selectedOpencodeAgentId,
		selectedThinkingLevel,
		messages,
		sessions,
		showSessions,
		loadPersistedSessions: () => persistedSessions.value,
		flushPersistedSessions: flushSessionsBestEffort,
		getCreatedAtBySessionId: () => createdAtBySessionId,
		setCreatedAtBySessionId: (value) => {
			createdAtBySessionId = value;
		},
		providerFromModelId,
	});

	const { startEditingTitle, setEditableTitle, saveTitle, onTitleEditKeydown } = createTitleEditor({
		currentTitle,
		isEditingTitle,
		editableTitle,
		onPersistTitle: persistCurrentSession,
	});

	const {
		sendMessage,
		abortStream,
		setComposerText,
		onComposerKeydown,
		onImageSelect,
		onComposerPaste,
		removePendingImage,
	} = createComposerActions({
		messages,
		isStreaming,
		composerText,
		errorMessage,
		pendingImages,
		selectedModelId,
		selectedThinkingLevel,
		selectedOpencodeAgentId,
		onConversationSettled: () => {
			syncDerivedState();
			void persistCurrentSession();
		},
	});

	function syncDerivedState() {
		selectedProvider.value = providerFromModelId(selectedModelId.value || opencodeAgents.value[0]?.model || "mistral");
		if (!currentTitle.value && shouldPersistSession(messages.value)) {
			currentTitle.value = generateTitle(messages.value);
		}
	}

	function selectedOpencodeAgentProfile() {
		return opencodeAgents.value.find((agent) => agent.id === selectedOpencodeAgentId.value);
	}

	function queueSystemNotification() {
		messages.value = [
			...messages.value,
			createSystemNotification("This notice is UI-only. It gets transformed for the model but remains visible to users."),
		];
		void persistCurrentSession();
	}

	function setMistralApiKey(value: string) {
		mistralApiKey.value = value;
	}

	function setSelectedThinkingLevel(value: ThinkingLevel) {
		selectedThinkingLevel.value = value;
	}

	function setSelectedModelId(modelId: string) {
		selectedModelId.value = modelId;
		selectedProvider.value = providerFromModelId(modelId);
	}

	function setSelectedProvider(provider: string) {
		selectedProvider.value = provider;
		const matchingModel = opencodeAgents.value.find((agent) => providerFromModelId(agent.model) === provider)?.model || opencodeModels.value[0];
		if (matchingModel) {
			selectedModelId.value = matchingModel;
		}
	}

	function setSelectedOpencodeAgentId(agentId: string) {
		const profile = opencodeAgents.value.find((agent) => agent.id === agentId);
		if (!profile) {
			return;
		}

		selectedOpencodeAgentId.value = profile.id;
		selectedModelId.value = profile.model;
		selectedProvider.value = providerFromModelId(profile.model);
	}

	function persistCurrentSelection() {
		return persistSelection({
			modelId: selectedModelId.value,
			agentId: selectedOpencodeAgentId.value || "default",
			thinkingMode: selectedThinkingLevel.value,
		});
	}

	function applySettings() {
		void persistMistralApiKey(mistralApiKey.value);
		void persistCurrentSelection();
		void persistCurrentSession();
		showSettings.value = false;
	}

	function applyQuickModelSettings() {
		void persistCurrentSelection();
		void persistCurrentSession();
	}

	async function loginOpenAICodex() {
		try {
			const credentials = await loginOpenAICodexByBrowser();
			openAICodexCredentials.value = { accountId: credentials.accountId, expires: credentials.expires };
			await persistOpenAICodexCredentials(credentials);
			errorMessage.value = undefined;
		} catch (error) {
			errorMessage.value = error instanceof Error ? error.message : "OpenAI login failed.";
		}
	}

	function logoutOpenAICodex() {
		openAICodexCredentials.value = undefined;
		void persistOpenAICodexCredentials(undefined);
	}

	function toggleSessions() {
		showSessions.value = !showSessions.value;
	}

	function toggleSettings() {
		showSettings.value = !showSettings.value;
	}

	function closeSessions() {
		showSessions.value = false;
	}

	function closeSettings() {
		showSettings.value = false;
	}

	function flushSessionsOnPageExit() {
		flushPersistedSessions();
	}

	onMounted(async () => {
		window.addEventListener("pagehide", flushSessionsOnPageExit);
		window.addEventListener("beforeunload", flushSessionsOnPageExit);

		try {
			const [catalog, persistedState] = await Promise.all([loadServerCatalog(), loadServerState()]);
			availableProviders.value = catalog.providers;
			thinkingLevels.value = catalog.thinkingLevels;
			opencodeAgents.value = catalog.agents;
			opencodeModels.value = catalog.models;
			mistralApiKey.value = persistedState.mistralApiKey || import.meta.env.VITE_MISTRAL_API_KEY || "";
			openAICodexCredentials.value = persistedState.openAICodexCredentials;
			persistedSessions.value = persistedState.sessions;

			selectedOpencodeAgentId.value = persistedState.selection.agentId || catalog.defaultAgentId;
			selectedModelId.value = persistedState.selection.modelId || selectedOpencodeAgentProfile()?.model || catalog.defaultModelId;
			selectedThinkingLevel.value =
				(typeof persistedState.selection.thinkingMode === "string" ? persistedState.selection.thinkingMode : "off") as ThinkingLevel;
			syncDerivedState();
		} catch (error) {
			errorMessage.value = error instanceof Error ? error.message : "Failed to load backend state.";
			mistralApiKey.value = import.meta.env.VITE_MISTRAL_API_KEY || "";
		}

		initializeStoredSessions();

		const sessionIdToLoad = new URLSearchParams(window.location.search).get("session") ?? sessions.value[0]?.id;
		if (sessionIdToLoad) {
			const loaded = await loadSession(sessionIdToLoad);
			if (loaded) {
				syncDerivedState();
				return;
			}
		}

		messages.value = [];
		syncDerivedState();
	});

	onBeforeUnmount(() => {
		window.removeEventListener("pagehide", flushSessionsOnPageExit);
		window.removeEventListener("beforeunload", flushSessionsOnPageExit);
	});

	return {
		AVAILABLE_PROVIDERS: availableProviders,
		THINKING_LEVELS: thinkingLevels,
		opencodeAgents,
		opencodeModels,
		hasMessages,
		models,
		hasOpenAICodexLogin,
		agentReady,
		currentTitle,
		isEditingTitle,
		editableTitle,
		showSessions,
		showSettings,
		sessions,
		composerText,
		mistralApiKey,
		selectedProvider,
		selectedModelId,
		selectedThinkingLevel,
		selectedOpencodeAgentId,
		messages,
		isStreaming,
		errorMessage,
		pendingImages,
		toggleSessions,
		toggleSettings,
		closeSessions,
		closeSettings,
		startNewSession,
		startEditingTitle,
		setEditableTitle,
		onTitleEditKeydown,
		saveTitle,
		queueSystemNotification,
		loadSession,
		removeSession,
		setMistralApiKey,
		setSelectedThinkingLevel,
		setSelectedOpencodeAgentId,
		applySettings,
		setSelectedProvider,
		setSelectedModelId,
		applyQuickModelSettings,
		loginOpenAICodex,
		logoutOpenAICodex,
		onImageSelect,
		setComposerText,
		onComposerKeydown,
		onComposerPaste,
		sendMessage,
		abortStream,
		removePendingImage,
	};
}
