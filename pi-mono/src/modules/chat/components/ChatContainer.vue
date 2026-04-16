<script setup lang="ts">
import ChatView from "./ChatView.vue";
import { useChatController } from "../composables/useChatController";

const chat = useChatController();
</script>

<template>
	<ChatView
		:available-providers="chat.AVAILABLE_PROVIDERS"
		:thinking-levels="chat.THINKING_LEVELS"
		:has-messages="chat.hasMessages"
		:models="chat.models"
		:agent-ready="chat.agentReady"
		:current-title="chat.currentTitle"
		:is-editing-title="chat.isEditingTitle"
		:editable-title="chat.editableTitle"
		:show-sessions="chat.showSessions"
		:show-settings="chat.showSettings"
		:sessions="chat.sessions"
		:composer-text="chat.composerText"
		:mistral-api-key="chat.mistralApiKey"
		:selected-provider="chat.selectedProvider"
		:selected-model-id="chat.selectedModelId"
		:selected-thinking-level="chat.selectedThinkingLevel"
		:messages="chat.messages"
		:is-streaming="chat.isStreaming"
		:error-message="chat.errorMessage"
		:pending-images="chat.pendingImages"
		:on-toggle-sessions="chat.toggleSessions"
		:on-toggle-settings="chat.toggleSettings"
		:on-start-new-session="chat.startNewSession"
		:on-start-editing-title="chat.startEditingTitle"
		:on-editable-title-change="chat.setEditableTitle"
		:on-title-edit-keydown="chat.onTitleEditKeydown"
		:on-save-title="chat.saveTitle"
		:on-queue-system-notification="chat.queueSystemNotification"
		:on-load-session="chat.loadSession"
		:on-remove-session="chat.removeSession"
		:on-mistral-api-key-change="chat.setMistralApiKey"
		:on-thinking-level-change="chat.setSelectedThinkingLevel"
		:on-apply-settings="chat.applySettings"
		:on-image-select="chat.onImageSelect"
		:on-model-change="chat.setSelectedModelId"
		:on-apply-quick-model-settings="chat.applyQuickModelSettings"
		:on-composer-text-change="chat.setComposerText"
		:on-composer-keydown="chat.onComposerKeydown"
		:on-send-message="chat.sendMessage"
		:on-abort-stream="chat.abortStream"
		:on-remove-pending-image="chat.removePendingImage"
	/>
</template>
