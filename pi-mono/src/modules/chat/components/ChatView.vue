<script setup lang="ts">
import type { AgentMessage, ThinkingLevel } from "@mariozechner/pi-agent-core";
import ChatComposer from "~src/core/ui/chat/ChatComposer.vue";
import ChatIntroBar from "~src/core/ui/chat/ChatIntroBar.vue";
import ChatMessageList from "~src/core/ui/chat/ChatMessageList.vue";
import ChatSessionsPanel from "~src/core/ui/chat/ChatSessionsPanel.vue";
import ChatSettingsPanel from "~src/core/ui/chat/ChatSettingsPanel.vue";
import ChatToolbar from "~src/core/ui/chat/ChatToolbar.vue";
import type { ModelOption } from "~src/core/ui/chat/types";
import type { PendingImage } from "~src/core/chat/types/chat";
import type { StoredSession } from "~src/modules/chat/types/chat";

const props = defineProps<{
	availableProviders: readonly string[];
	thinkingLevels: ThinkingLevel[];
	hasMessages: boolean;
	models: ModelOption[];
	agentReady: boolean;
	currentTitle: string;
	isEditingTitle: boolean;
	editableTitle: string;
	showSessions: boolean;
	showSettings: boolean;
	sessions: StoredSession[];
	composerText: string;
	mistralApiKey: string;
	selectedProvider: string;
	selectedModelId: string;
	selectedThinkingLevel: ThinkingLevel;
	messages: AgentMessage[];
	isStreaming: boolean;
	errorMessage?: string;
	pendingImages: PendingImage[];
	onToggleSessions: () => void;
	onToggleSettings: () => void;
	onStartNewSession: () => Promise<void>;
	onStartEditingTitle: () => void;
	onEditableTitleChange: (value: string) => void;
	onTitleEditKeydown: (event: KeyboardEvent) => void;
	onSaveTitle: () => void;
	onQueueSystemNotification: () => void;
	onLoadSession: (sessionId: string) => Promise<void>;
	onRemoveSession: (sessionId: string) => void;
	onMistralApiKeyChange: (value: string) => void;
	onThinkingLevelChange: (value: ThinkingLevel) => void;
	onApplySettings: () => void;
	onImageSelect: (event: Event) => Promise<void>;
	onModelChange: (modelId: string) => void;
	onApplyQuickModelSettings: () => void;
	onComposerTextChange: (value: string) => void;
	onComposerKeydown: (event: KeyboardEvent) => void;
	onComposerPaste: (event: ClipboardEvent) => void;
	onSendMessage: () => Promise<void>;
	onAbortStream: () => void;
	onRemovePendingImage: (imageId: string) => void;
}>();

function handleThinkingLevelChange(value: string) {
	props.onThinkingLevelChange(value as ThinkingLevel);
}
</script>

<template>
	<div class="chat-view-shell">
		<ChatToolbar
			:current-title="currentTitle"
			:is-editing-title="isEditingTitle"
			:editable-title="editableTitle"
			@toggle-sessions="onToggleSessions"
			@start-new-session="onStartNewSession"
			@start-editing-title="onStartEditingTitle"
			@editable-title-input="onEditableTitleChange"
			@title-edit-keydown="onTitleEditKeydown"
			@save-title="onSaveTitle"
			@queue-notification="onQueueSystemNotification"
			@toggle-settings="onToggleSettings"
		>
			<ChatSessionsPanel
				:open="showSessions"
				:sessions="sessions"
				@open-session="onLoadSession"
				@delete-session="onRemoveSession"
			/>
			<ChatSettingsPanel
				:open="showSettings"
				:mistral-api-key="mistralApiKey"
				:selected-thinking-level="selectedThinkingLevel"
				:thinking-levels="thinkingLevels"
				@api-key-input="onMistralApiKeyChange"
				@thinking-level-change="handleThinkingLevelChange"
				@apply-settings="onApplySettings"
			/>
		</ChatToolbar>

		<main class="chat-view-content">
			<ChatIntroBar
				:selected-provider="selectedProvider"
				:selected-model-id="selectedModelId"
				:selected-thinking-level="selectedThinkingLevel"
			/>
			<ChatMessageList
				:has-messages="hasMessages"
				:messages="messages"
				:is-streaming="isStreaming"
				:error-message="errorMessage"
			/>
			<ChatComposer
				:composer-text="composerText"
				:agent-ready="agentReady"
				:pending-images="pendingImages"
				:available-providers="availableProviders"
				:selected-provider="selectedProvider"
				:selected-model-id="selectedModelId"
				:models="models"
				:is-streaming="isStreaming"
				@update:composer-text="onComposerTextChange"
				@composer-keydown="onComposerKeydown"
				@composer-paste="onComposerPaste"
				@image-select="onImageSelect"
				@model-change="onModelChange"
				@apply-quick-model-settings="onApplyQuickModelSettings"
				@send="onSendMessage"
				@abort="onAbortStream"
				@remove-pending-image="onRemovePendingImage"
			/>
		</main>
	</div>
</template>

<style scoped>
.chat-view-shell {
	min-height: 100vh;
	display: flex;
	flex-direction: column;
	background:
		radial-gradient(circle at top, rgba(22, 77, 35, 0.2), transparent 38%),
		linear-gradient(180deg, #07110a 0%, #040904 100%);
	box-sizing: border-box;
}

.chat-view-shell * {
	box-sizing: border-box;
}

.chat-view-content {
	flex: 1;
	display: flex;
	flex-direction: column;
	min-height: 0;
	padding: 1rem 1.25rem 1.25rem;
	gap: 1rem;
}
</style>

<style>
html,
body,
#app {
	min-height: 100%;
}

body {
	margin: 0;
	background: #07110a;
	color: #9cffb2;
	font-family: "JetBrains Mono", "Fira Code", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
}
</style>
