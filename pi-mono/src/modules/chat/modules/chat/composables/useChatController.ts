import type { AgentMessage, AgentState, ThinkingLevel } from "@mariozechner/pi-agent-core";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
	AVAILABLE_PROVIDERS,
	DEFAULT_MODEL_ID,
	DEFAULT_PROVIDER,
	THINKING_LEVELS,
} from "~src/modules/chat/modules/modelsProviders/shared/constants/models";
import type { OpenAICodexCredentials } from "~src/modules/chat/modules/agents/services/openaiCodexOAuth";
import { loginOpenAICodexByBrowser } from "~src/modules/chat/modules/agents/services/openaiCodexOAuth";
import { createAgentInstance } from "~src/modules/chat/modules/agents/services/agent";
import { availableModels, resolveModel } from "~src/modules/chat/modules/modelsProviders/services/models";
import type { PendingImage } from "~src/modules/chat/modules/chat/shared/types/chat";
import { createSystemNotification } from "~src/modules/chat/modules/chat/shared/utils/custom-messages";
import type { StoredSession } from "~src/modules/chat/modules/sessions/domain/types";
import { createSubscribedAgent, disposeAgentSubscription } from "~src/modules/chat/modules/agents/composables/agents";
import {
	applySelectedModelToAgent,
	providerFromModelId,
} from "~src/modules/chat/modules/modelsProviders/composables/modelsProviders";
import { createComposerActions } from "~src/modules/chat/modules/chat/composables/composerActions";
import { createSessionActions } from "~src/modules/chat/modules/sessions/composables/sessionActions";
import {
	flushSessionsBestEffort,
	loadServerState,
	persistMistralApiKey,
	persistOpenAICodexCredentials,
} from "~src/modules/chat/modules/persistence/services/serverState";
import { createTitleEditor } from "~src/modules/chat/modules/titleGeneration/composables/titleEditor";
import { shouldPersistSession } from "~src/modules/chat/modules/sessions/domain/helpers";
import { generateTitle } from "~src/modules/chat/modules/titleGeneration/domain/title";
import {
	findOpencodeAgent,
	getDefaultPrimaryAgentId,
	getOpencodeAgents,
	getOpencodeModels,
} from "~src/modules/chat/modules/opencodeConfig/services/opencode";

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
	const openAICodexCredentials = ref<OpenAICodexCredentials | undefined>();
	const selectedProvider = ref<(typeof AVAILABLE_PROVIDERS)[number]>(DEFAULT_PROVIDER);
	const selectedModelId = ref(DEFAULT_MODEL_ID);
	const selectedThinkingLevel = ref<ThinkingLevel>("off");
	const opencodeAgents = getOpencodeAgents();
	const opencodeModels = getOpencodeModels();
	const selectedOpencodeAgentId = ref<string | undefined>(getDefaultPrimaryAgentId());
	const persistedSessions = ref<StoredSession[]>([]);

	const messages = ref<AgentMessage[]>([]);
	const isStreaming = ref(false);
	const errorMessage = ref<string | undefined>();
	const pendingImages = ref<PendingImage[]>([]);

	let createdAtBySessionId = new Map<string, string>();
	let agent = createAgentInstance({
		selectedModelId: selectedModelId.value,
		mistralApiKey: mistralApiKey.value,
		openAICodexCredentials: openAICodexCredentials.value,
		onOpenAICodexCredentialsChange: (credentials) => {
			openAICodexCredentials.value = credentials;
			void persistOpenAICodexCredentials(credentials);
		},
	});
	let agentUnsubscribe: (() => void) | undefined;

	const hasMessages = computed(() => messages.value.length > 0);
	const models = computed(() => availableModels(selectedProvider.value));
	const hasOpenAICodexLogin = computed(() => Boolean(openAICodexCredentials.value));
	const agentReady = computed(() => Boolean(agent));

	function selectedOpencodeAgentProfile() {
		return selectedOpencodeAgentId.value ? findOpencodeAgent(selectedOpencodeAgentId.value) : undefined;
	}

	function applySelectedOpencodeAgent(agentInstance: typeof agent) {
		const profile = selectedOpencodeAgentProfile();
		if (!profile) {
			return;
		}

		agentInstance.state.systemPrompt = profile.prompt;
	}

	async function createAgent(initialState?: Partial<AgentState>) {
		disposeAgentSubscription(agentUnsubscribe);
		agentUnsubscribe = undefined;

		const subscribedAgent = createSubscribedAgent({
			initialState: {
				...initialState,
				systemPrompt: initialState?.systemPrompt ?? selectedOpencodeAgentProfile()?.prompt,
			},
			selectedModelId: selectedModelId.value,
			mistralApiKey: mistralApiKey.value,
			openAICodexCredentials: openAICodexCredentials.value,
			onOpenAICodexCredentialsChange: (credentials) => {
				openAICodexCredentials.value = credentials;
				void persistOpenAICodexCredentials(credentials);
			},
			onStateChange: syncFromAgent,
		});

		agent = subscribedAgent.agent;
		agentUnsubscribe = subscribedAgent.unsubscribe;

		syncFromAgent();
	}

	const {
		initializeStoredSessions,
		persistCurrentSession,
		flushPersistedSessions,
		loadSession,
		startNewSession,
		removeSession,
	} = createSessionActions({
		getAgent: () => agent,
		createAgent,
		currentSessionId,
		currentTitle,
		selectedProvider,
		selectedModelId,
		selectedOpencodeAgentId,
		selectedThinkingLevel,
		sessions,
		showSessions,
		loadPersistedSessions: () => persistedSessions.value,
		flushPersistedSessions: flushSessionsBestEffort,
		getCreatedAtBySessionId: () => createdAtBySessionId,
		setCreatedAtBySessionId: (value) => {
			createdAtBySessionId = value;
		},
	});

	function flushSessionsOnPageExit() {
		flushPersistedSessions();
	}

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
		getAgent: () => agent,
		isStreaming,
		composerText,
		errorMessage,
		pendingImages,
	});


	function syncFromAgent() {
		if (!agent) {
			return;
		}

		messages.value = [...agent.state.messages];
		isStreaming.value = Boolean(agent.state.isStreaming);
		errorMessage.value = agent.state.errorMessage;
		selectedThinkingLevel.value = agent.state.thinkingLevel;
		selectedModelId.value = agent.state.model?.id || selectedModelId.value;
		selectedProvider.value = providerFromModelId(selectedModelId.value);

		if (!currentTitle.value && shouldPersistSession(messages.value)) {
			currentTitle.value = generateTitle(messages.value);
		}

		if (!agent.state.isStreaming) {
			void persistCurrentSession();
		}
	}


	function queueSystemNotification() {
		agent?.steer(
			createSystemNotification("This notice is UI-only. It gets transformed for the model but remains visible to users."),
		);
	}

	function setMistralApiKey(value: string) {
		mistralApiKey.value = value;
	}

	function setSelectedThinkingLevel(value: ThinkingLevel) {
		selectedThinkingLevel.value = value;
	}

	function applySettings() {
		void persistMistralApiKey(mistralApiKey.value);
		void persistOpenAICodexCredentials(openAICodexCredentials.value);

		if (!agent) {
			showSettings.value = false;
			return;
		}

		applySelectedModelToAgent(agent, selectedModelId.value);
		applySelectedOpencodeAgent(agent);

		agent.state.thinkingLevel = selectedThinkingLevel.value;
		void persistCurrentSession();
		showSettings.value = false;
	}

	function setSelectedModelId(modelId: string) {
		selectedModelId.value = modelId;
	}

	function setSelectedProvider(provider: string) {
		if (!AVAILABLE_PROVIDERS.includes(provider as (typeof AVAILABLE_PROVIDERS)[number])) {
			return;
		}
		const nextProvider = provider as (typeof AVAILABLE_PROVIDERS)[number];

		selectedProvider.value = nextProvider;
		const providerModels = availableModels(nextProvider);
		if (providerModels.length === 0) {
			return;
		}

		const currentModelStillValid = providerModels.some((model) => model.id === selectedModelId.value);
		if (!currentModelStillValid) {
			selectedModelId.value = providerModels[0].id;
		}
	}

	function setSelectedOpencodeAgentId(agentId: string) {
		const profile = findOpencodeAgent(agentId);
		if (!profile) {
			return;
		}

		selectedOpencodeAgentId.value = profile.id;
		selectedModelId.value = profile.model;
		selectedProvider.value = providerFromModelId(profile.model);
	}

	async function loginOpenAICodex() {
		try {
			const credentials = await loginOpenAICodexByBrowser();
			openAICodexCredentials.value = credentials;
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

	function applyQuickModelSettings() {
		if (!agent) {
			return;
		}

		const modelId = applySelectedModelToAgent(agent, selectedModelId.value);
		applySelectedOpencodeAgent(agent);
		if (modelId) {
			selectedProvider.value = providerFromModelId(modelId);
		}

		void persistCurrentSession();
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

	onMounted(async () => {
		window.addEventListener("pagehide", flushSessionsOnPageExit);
		window.addEventListener("beforeunload", flushSessionsOnPageExit);

		try {
			const persistedState = await loadServerState();
			mistralApiKey.value = persistedState.mistralApiKey || import.meta.env.VITE_MISTRAL_API_KEY || "";
			openAICodexCredentials.value = persistedState.openAICodexCredentials;
			persistedSessions.value = persistedState.sessions;
		} catch (error) {
			errorMessage.value = error instanceof Error ? error.message : "Failed to load server state.";
			mistralApiKey.value = import.meta.env.VITE_MISTRAL_API_KEY || "";
			persistedSessions.value = [];
		}

		initializeStoredSessions();

		const sessionIdToLoad = new URLSearchParams(window.location.search).get("session") ?? sessions.value[0]?.id;
		if (sessionIdToLoad) {
			const loaded = await loadSession(sessionIdToLoad);
			if (loaded) {
				return;
			}
		}

		await createAgent({
			messages: [],
			thinkingLevel: "off",
			model: resolveModel(selectedModelId.value),
			tools: [],
		});
	});

	onBeforeUnmount(() => {
		window.removeEventListener("pagehide", flushSessionsOnPageExit);
		window.removeEventListener("beforeunload", flushSessionsOnPageExit);

		disposeAgentSubscription(agentUnsubscribe);
		agentUnsubscribe = undefined;
	});

	return {
		AVAILABLE_PROVIDERS,
		THINKING_LEVELS,
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
