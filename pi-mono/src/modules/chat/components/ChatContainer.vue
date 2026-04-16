<script setup lang="ts">
import ChatView from "./ChatView.vue";
import { useChatController } from "~src/modules/chat/composables/useChatController";

const chat = useChatController();

const {
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
} = chat;
</script>

<template>
	<ChatView
		:available-providers="AVAILABLE_PROVIDERS"
		:thinking-levels="THINKING_LEVELS"
		:has-messages="hasMessages"
		:models="models"
		:agent-ready="agentReady"
		:current-title="currentTitle"
		:is-editing-title="isEditingTitle"
		:editable-title="editableTitle"
		:show-sessions="showSessions"
		:show-settings="showSettings"
		:sessions="sessions"
		:composer-text="composerText"
		:mistral-api-key="mistralApiKey"
		:selected-provider="selectedProvider"
		:selected-model-id="selectedModelId"
		:selected-thinking-level="selectedThinkingLevel"
		:messages="messages"
		:is-streaming="isStreaming"
		:error-message="errorMessage"
		:pending-images="pendingImages"
		:on-toggle-sessions="toggleSessions"
		:on-toggle-settings="toggleSettings"
		:on-start-new-session="startNewSession"
		:on-start-editing-title="startEditingTitle"
		:on-editable-title-change="setEditableTitle"
		:on-title-edit-keydown="onTitleEditKeydown"
		:on-save-title="saveTitle"
		:on-queue-system-notification="queueSystemNotification"
		:on-load-session="loadSession"
		:on-remove-session="removeSession"
		:on-mistral-api-key-change="setMistralApiKey"
		:on-thinking-level-change="setSelectedThinkingLevel"
		:on-apply-settings="applySettings"
		:on-image-select="onImageSelect"
		:on-model-change="setSelectedModelId"
		:on-apply-quick-model-settings="applyQuickModelSettings"
		:on-composer-text-change="setComposerText"
		:on-composer-keydown="onComposerKeydown"
		:on-composer-paste="onComposerPaste"
		:on-send-message="sendMessage"
		:on-abort-stream="abortStream"
		:on-remove-pending-image="removePendingImage"
	/>
</template>
