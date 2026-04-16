<script setup lang="ts">
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { computed } from "vue";
import { imageSrc, isImageContent } from "~src/modules/chat/modules/chat/shared/helpers/images";
import { messageTimestamp } from "~src/modules/chat/modules/chat/shared/helpers/messages";
import { extractPlainText, isSystemNotification } from "~src/modules/chat/modules/chat/shared/utils/custom-messages";

const props = defineProps<{
	message: AgentMessage;
	index: number;
}>();

const messageKey = computed(() => `${props.index}-${props.message.role}`);
const rowClasses = computed(() => [
	"message-row",
	props.message.role,
	isSystemNotification(props.message) ? props.message.variant : "",
]);
const timestamp = computed(() => messageTimestamp(props.message));
</script>

<template>
	<article :class="rowClasses">
		<div class="message-label">{{ message.role }}</div>
		<div class="message-body">
			<template v-if="message.role === 'user'">
				<template v-if="typeof message.content === 'string'">
					{{ message.content }}
				</template>
				<template v-else>
					<template v-for="(block, blockIndex) in message.content" :key="`${messageKey}-user-${blockIndex}`">
						<div v-if="block.type === 'text'">{{ block.text }}</div>
						<img v-else-if="isImageContent(block)" class="message-image" :src="imageSrc(block)" alt="Uploaded image" />
					</template>
				</template>
			</template>

			<template v-else-if="message.role === 'assistant'">
				<template v-for="(block, blockIndex) in message.content" :key="`${messageKey}-${blockIndex}`">
					<div v-if="block.type === 'text'">{{ block.text }}</div>
					<details v-else-if="block.type === 'thinking'">
						<summary>Reasoning</summary>
						<div>{{ block.thinking }}</div>
					</details>
					<div v-else-if="block.type === 'toolCall'" class="tool-block">
						<div>{{ block.name }}</div>
						<pre>{{ JSON.stringify(block.arguments, null, 2) }}</pre>
					</div>
				</template>
			</template>

			<template v-else-if="message.role === 'toolResult'">
				<div class="tool-block">
					<div>{{ message.toolName }} {{ message.isError ? '(error)' : '' }}</div>
					<pre>{{ extractPlainText(message.content) }}</pre>
				</div>
			</template>

			<template v-else-if="isSystemNotification(message)">
				<strong>{{ message.variant === 'destructive' ? 'Alert' : 'Notice' }}</strong>
				<div>{{ message.message }}</div>
			</template>

			<div v-if="timestamp" class="status timestamp">{{ timestamp }}</div>
		</div>
	</article>
</template>

<style scoped>
.message-row {
	display: grid;
	grid-template-columns: 7rem minmax(0, 1fr);
	gap: 1rem;
	align-items: start;
	padding: 0.9rem 1rem;
	border-left: 2px solid rgba(100, 255, 140, 0.18);
	background: rgba(7, 17, 10, 0.45);
}

.message-row.user {
	border-left-color: #4fff7a;
}

.message-row.assistant {
	border-left-color: #98ff98;
}

.message-row.system-notification {
	border-left-color: #ffe36a;
}

.message-row.destructive {
	border-left-color: #ff7d7d;
}

.message-label {
	color: rgba(156, 255, 178, 0.72);
	text-transform: uppercase;
	letter-spacing: 0.08em;
	font-size: 0.8rem;
	padding-top: 0.15rem;
}

.message-body {
	display: grid;
	gap: 0.7rem;
	white-space: pre-wrap;
	word-break: break-word;
}

.tool-block,
details {
	padding: 0.7rem 0.85rem;
	border: 1px solid rgba(100, 255, 140, 0.14);
	background: rgba(9, 22, 12, 0.7);
}

pre {
	margin: 0;
	white-space: pre-wrap;
	word-break: break-word;
	color: inherit;
}

.message-image {
	display: block;
	max-width: 100%;
	border: 1px solid rgba(100, 255, 140, 0.2);
	max-height: 20rem;
	width: auto;
	background: rgba(0, 0, 0, 0.25);
}

.status {
	color: rgba(156, 255, 178, 0.68);
	font-size: 0.84rem;
}

.timestamp {
	margin-top: -0.15rem;
}

@media (max-width: 720px) {
	.message-row {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
}
</style>
