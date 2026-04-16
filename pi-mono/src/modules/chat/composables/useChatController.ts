import type { AgentMessage, AgentState, ThinkingLevel } from "@mariozechner/pi-agent-core";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
	AVAILABLE_PROVIDERS,
	API_KEY_KEY,
	DEFAULT_MODEL_ID,
	DEFAULT_PROVIDER,
	SESSIONS_KEY,
	THINKING_LEVELS,
} from "../constants/chat";
import { createAgentInstance, availableModels, inferProvider, resolveModel } from "../api/agent";
import type { PendingImage, StoredSession } from "../types/chat";
import { createSystemNotification } from "../utils/custom-messages";
import { fileToPendingImage } from "../helpers/images";
import {
	generateTitle,
	loadStoredSessions,
	saveStoredSessions,
	shouldPersistSession,
	upsertSession,
} from "../helpers/sessions";

export function useChatController() {
	const currentSessionId = ref<string | undefined>();
	const currentTitle = ref("");
	const isEditingTitle = ref(false);
	const editableTitle = ref("");

	const showSessions = ref(false);
	const showSettings = ref(false);

	const sessions = ref<StoredSession[]>([]);
	const composerText = ref("");
	const mistralApiKey = ref(localStorage.getItem(API_KEY_KEY) || import.meta.env.VITE_MISTRAL_API_KEY || "");
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

	function syncFromAgent() {
		if (!agent) {
			return;
		}

		messages.value = [...agent.state.messages];
		isStreaming.value = Boolean(agent.state.isStreaming);
		errorMessage.value = agent.state.errorMessage;
		selectedThinkingLevel.value = agent.state.thinkingLevel;
		selectedModelId.value = agent.state.model?.id || selectedModelId.value;
		selectedProvider.value = inferProvider(selectedModelId.value);

		if (!currentTitle.value && shouldPersistSession(messages.value)) {
			currentTitle.value = generateTitle(messages.value);
		}

		persistCurrentSession();
	}

	function updateSessionParam(sessionId?: string) {
		const url = new URL(window.location.href);
		if (sessionId) {
			url.searchParams.set("session", sessionId);
		} else {
			url.searchParams.delete("session");
		}
		window.history.replaceState({}, "", url.toString());
	}

	function persistSessions(nextSessions: StoredSession[]) {
		sessions.value = saveStoredSessions(SESSIONS_KEY, nextSessions);
	}

	function persistCurrentSession() {
		if (!agent || !shouldPersistSession(agent.state.messages)) {
			return;
		}

		if (!currentSessionId.value) {
			currentSessionId.value = crypto.randomUUID();
			updateSessionParam(currentSessionId.value);
		}

		const id = currentSessionId.value;
		if (!id) {
			return;
		}

		const createdAt = createdAtBySessionId.get(id) || new Date().toISOString();
		createdAtBySessionId.set(id, createdAt);

		const storedSession: StoredSession = {
			id,
			title: currentTitle.value || generateTitle(agent.state.messages),
			modelId: agent.state.model?.id || selectedModelId.value,
			thinkingLevel: agent.state.thinkingLevel,
			messages: [...agent.state.messages],
			createdAt,
			lastModified: new Date().toISOString(),
		};

		if (!currentTitle.value) {
			currentTitle.value = storedSession.title;
		}

		persistSessions(upsertSession(sessions.value, storedSession));
	}

	async function createAgent(initialState?: Partial<AgentState>) {
		if (agentUnsubscribe) {
			agentUnsubscribe();
			agentUnsubscribe = undefined;
		}

		agent = createAgentInstance({
			initialState,
			selectedModelId: selectedModelId.value,
			mistralApiKey: mistralApiKey.value,
		});

		agentUnsubscribe = agent.subscribe(() => {
			syncFromAgent();
		});

		syncFromAgent();
	}

	async function loadSession(sessionId: string) {
		const session = sessions.value.find((item) => item.id === sessionId);
		if (!session) {
			return;
		}

		createdAtBySessionId.set(session.id, session.createdAt);
		currentSessionId.value = session.id;
		currentTitle.value = session.title;
		selectedProvider.value = inferProvider(session.modelId);
		selectedModelId.value = session.modelId;
		selectedThinkingLevel.value = session.thinkingLevel;
		updateSessionParam(session.id);

		await createAgent({
			model: resolveModel(session.modelId),
			thinkingLevel: session.thinkingLevel,
			messages: session.messages,
			tools: [],
		});

		showSessions.value = false;
	}

	async function startNewSession() {
		currentSessionId.value = undefined;
		currentTitle.value = "";
		updateSessionParam(undefined);
		await createAgent({
			messages: [],
			thinkingLevel: selectedThinkingLevel.value,
			model: resolveModel(selectedModelId.value),
			tools: [],
		});
	}

	function removeSession(sessionId: string) {
		const filtered = sessions.value.filter((session) => session.id !== sessionId);
		persistSessions(filtered);
		createdAtBySessionId.delete(sessionId);

		if (sessionId === currentSessionId.value) {
			void startNewSession();
		}
	}

	function startEditingTitle() {
		editableTitle.value = currentTitle.value || "";
		isEditingTitle.value = true;
	}

	function setEditableTitle(value: string) {
		editableTitle.value = value;
	}

	function saveTitle() {
		const nextTitle = editableTitle.value.trim();
		if (nextTitle) {
			currentTitle.value = nextTitle;
			persistCurrentSession();
		}
		isEditingTitle.value = false;
	}

	function cancelTitleEdit() {
		isEditingTitle.value = false;
	}

	async function sendMessage() {
		if (!agent || isStreaming.value) {
			return;
		}

		const content = composerText.value.trim();
		const images = pendingImages.value.map(({ data, mimeType, type }) => ({ data, mimeType, type }));
		if (!content && images.length === 0) {
			return;
		}

		composerText.value = "";
		errorMessage.value = undefined;
		isStreaming.value = true;
		try {
			await agent.prompt(content, images);
			pendingImages.value = [];
		} catch (error) {
			errorMessage.value = error instanceof Error ? error.message : "Message failed";
		} finally {
			isStreaming.value = Boolean(agent.state.isStreaming);
		}
	}

	function abortStream() {
		agent?.abort();
		isStreaming.value = false;
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
		localStorage.setItem(API_KEY_KEY, mistralApiKey.value);

		if (!agent) {
			showSettings.value = false;
			return;
		}

		const nextModel = resolveModel(selectedModelId.value);
		if (nextModel) {
			agent.state.model = nextModel;
		}

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

		const nextModel = resolveModel(selectedModelId.value);
		if (nextModel) {
			agent.state.model = nextModel;
			selectedProvider.value = inferProvider(nextModel.id);
		}

		persistCurrentSession();
	}

	function onTitleEditKeydown(event: KeyboardEvent) {
		if (event.key === "Enter") {
			event.preventDefault();
			saveTitle();
		}
		if (event.key === "Escape") {
			event.preventDefault();
			cancelTitleEdit();
		}
	}

	function setComposerText(value: string) {
		composerText.value = value;
	}

	function onComposerKeydown(event: KeyboardEvent) {
		if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
			event.preventDefault();
			void sendMessage();
		}
	}

	async function onImageSelect(event: Event) {
		const input = event.target as HTMLInputElement | null;
		const files = input?.files ? Array.from(input.files) : [];
		if (files.length === 0) {
			return;
		}

		const imageFiles = files.filter((file) => file.type.startsWith("image/"));
		if (imageFiles.length !== files.length) {
			errorMessage.value = "Only image files are supported.";
		}

		try {
			const nextImages = await Promise.all(imageFiles.map(fileToPendingImage));
			pendingImages.value = [...pendingImages.value, ...nextImages];
		} catch (error) {
			errorMessage.value = error instanceof Error ? error.message : "Image upload failed";
		}

		if (input) {
			input.value = "";
		}
	}

	function removePendingImage(imageId: string) {
		pendingImages.value = pendingImages.value.filter((item) => item.id !== imageId);
	}

	function toggleSessions() {
		showSessions.value = !showSessions.value;
	}

	function toggleSettings() {
		showSettings.value = !showSettings.value;
	}

	onMounted(async () => {
		sessions.value = loadStoredSessions(SESSIONS_KEY);
		for (const session of sessions.value) {
			createdAtBySessionId.set(session.id, session.createdAt);
		}

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
		if (agentUnsubscribe) {
			agentUnsubscribe();
		}
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
		sendMessage,
		abortStream,
		removePendingImage,
	};
}
