import type { AgentMessage, AgentState, ThinkingLevel } from "@mariozechner/pi-agent-core";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
	AVAILABLE_PROVIDERS,
	DEFAULT_MODEL_ID,
	DEFAULT_PROVIDER,
	THINKING_LEVELS,
} from "~src/modules/chat/constants/chat";
import { createAgentInstance, availableModels, resolveModel } from "~src/modules/chat/api/agent";
import type { PendingImage } from "~src/core/chat/types/chat";
import { createSystemNotification } from "~src/core/chat/utils/custom-messages";
import type { StoredSession } from "~src/modules/chat/types/chat";
import { createSubscribedAgent, disposeAgentSubscription } from "~src/modules/chat/composables/useChatController/agents";
import {
	applySelectedModelToAgent,
	providerFromModelId,
} from "~src/modules/chat/composables/useChatController/modelsProviders";
import { createComposerActions } from "~src/modules/chat/composables/useChatController/composerActions";
import { createSessionActions } from "~src/modules/chat/composables/useChatController/sessionActions";
import { persistMistralApiKey, getStoredMistralApiKey } from "~src/modules/chat/composables/useChatController/storage";
import { createTitleEditor } from "~src/modules/chat/composables/useChatController/titleEditor";
import {
	generateTitle,
	shouldPersistSession,
} from "~src/modules/chat/helpers/sessions";

export function useChatController() {
	const currentSessionId = ref<string | undefined>();
	const currentTitle = ref("");
	const isEditingTitle = ref(false);
	const editableTitle = ref("");

	const showSessions = ref(false);
	const showSettings = ref(false);

	const sessions = ref<StoredSession[]>([]);
	const composerText = ref("");
	const mistralApiKey = ref(getStoredMistralApiKey());
	const selectedProvider = ref<(typeof AVAILABLE_PROVIDERS)[number]>(DEFAULT_PROVIDER);
	const selectedModelId = ref(DEFAULT_MODEL_ID);
	const selectedThinkingLevel = ref<ThinkingLevel>("off");

	const messages = ref<AgentMessage[]>([]);
	const isStreaming = ref(false);
	const errorMessage = ref<string | undefined>();
	const pendingImages = ref<PendingImage[]>([]);

	let createdAtBySessionId = new Map<string, string>();
	let agent = createAgentInstance({ selectedModelId: selectedModelId.value, mistralApiKey: mistralApiKey.value });
	let agentUnsubscribe: (() => void) | undefined;

	const hasMessages = computed(() => messages.value.length > 0);
	const models = computed(() => availableModels(selectedProvider.value));
	const agentReady = computed(() => Boolean(agent));

	async function createAgent(initialState?: Partial<AgentState>) {
		disposeAgentSubscription(agentUnsubscribe);
		agentUnsubscribe = undefined;

		const subscribedAgent = createSubscribedAgent({
			initialState,
			selectedModelId: selectedModelId.value,
			mistralApiKey: mistralApiKey.value,
			onStateChange: syncFromAgent,
		});

		agent = subscribedAgent.agent;
		agentUnsubscribe = subscribedAgent.unsubscribe;

		syncFromAgent();
	}

	const {
		initializeStoredSessions,
		persistCurrentSession,
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
		selectedThinkingLevel,
		sessions,
		showSessions,
		getCreatedAtBySessionId: () => createdAtBySessionId,
		setCreatedAtBySessionId: (value) => {
			createdAtBySessionId = value;
		},
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

		persistCurrentSession();
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
		persistMistralApiKey(mistralApiKey.value);

		if (!agent) {
			showSettings.value = false;
			return;
		}

		applySelectedModelToAgent(agent, selectedModelId.value);

		agent.state.thinkingLevel = selectedThinkingLevel.value;
		persistCurrentSession();
		showSettings.value = false;
	}

	function setSelectedModelId(modelId: string) {
		selectedModelId.value = modelId;
	}

	function applyQuickModelSettings() {
		if (!agent) {
			return;
		}

		const modelId = applySelectedModelToAgent(agent, selectedModelId.value);
		if (modelId) {
			selectedProvider.value = providerFromModelId(modelId);
		}

		persistCurrentSession();
	}

	function toggleSessions() {
		showSessions.value = !showSessions.value;
	}

	function toggleSettings() {
		showSettings.value = !showSettings.value;
	}

	onMounted(async () => {
		initializeStoredSessions();

		const sessionIdFromUrl = new URLSearchParams(window.location.search).get("session");
		if (sessionIdFromUrl) {
			await loadSession(sessionIdFromUrl);
			if (agent) {
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
		disposeAgentSubscription(agentUnsubscribe);
		agentUnsubscribe = undefined;
	});

	return {
		AVAILABLE_PROVIDERS,
		THINKING_LEVELS,
		hasMessages,
		models,
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
		messages,
		isStreaming,
		errorMessage,
		pendingImages,
		toggleSessions,
		toggleSettings,
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
		applySettings,
		setSelectedModelId,
		applyQuickModelSettings,
		onImageSelect,
		setComposerText,
		onComposerKeydown,
		onComposerPaste,
		sendMessage,
		abortStream,
		removePendingImage,
	};
}
