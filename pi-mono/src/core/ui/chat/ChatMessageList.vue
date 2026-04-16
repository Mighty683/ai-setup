<script setup lang="ts">
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { nextTick, ref, watch } from "vue";
import ChatMessageItem from "./ChatMessageItem.vue";

const props = defineProps<{
	hasMessages: boolean;
	messages: AgentMessage[];
	isStreaming: boolean;
	errorMessage?: string;
}>();

const messagesContainer = ref<HTMLElement | null>(null);

watch(
	() => props.messages.length,
	() => {
		nextTick(() => {
			if (!messagesContainer.value) {
				return;
			}
			messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
		});
	},
);
</script>

<template>
	<section ref="messagesContainer" class="messages">
		<div v-if="!hasMessages" class="status">Start a conversation. Press Ctrl/Cmd + Enter to send from the composer.</div>
		<ChatMessageItem
			v-for="(message, index) in messages"
			:key="`${index}-${message.role}`"
			:message="message"
			:index="index"
		/>
		<div v-if="isStreaming" class="status streaming">assistant is responding...</div>
		<div v-if="errorMessage" class="status">{{ errorMessage }}</div>
	</section>
</template>

<style scoped>
.messages {
	flex: 1;
	min-height: 0;
	overflow: auto;
	display: flex;
	flex-direction: column;
	gap: 1rem;
	padding: 0.5rem 0.2rem;
}

.status {
	color: rgba(156, 255, 178, 0.68);
	font-size: 0.84rem;
}

.streaming {
	color: #4fff7a;
	animation: pulse 1.1s infinite alternate;
}

@keyframes pulse {
	from {
		opacity: 0.55;
	}
	to {
		opacity: 1;
	}
}
</style>
