<script setup lang="ts">
import { computed, ref } from "vue";
import { imageSrc, isImageContent } from "~src/modules/chat/modules/chat/shared/helpers/images";
import type { ChatMessage } from "~src/modules/chat/modules/chat/shared/types/chat";
import {
	extractPlainText,
	isSystemNotification,
} from "~src/modules/chat/modules/chat/shared/utils/custom-messages";

const props = defineProps<{
	message: ChatMessage;
	index: number;
}>();

const messageKey = computed(() => `${props.index}-${props.message.role}`);
const showSubagentModal = ref(false);
const activeSubagentRun = ref<SubagentRunDisplay | null>(null);
const rowClasses = computed(() => [
	"message-row",
	props.message.role,
	isSystemNotification(props.message) ? props.message.variant : "",
]);

type SubagentFlowEntry = {
	role: string;
	content: string;
	timestamp?: string;
};

type SubagentRunDisplay = {
	toolCallId: string;
	agentId: string;
	agentLabel: string;
	task: string;
	taskPreview: string;
	summary: string;
	flow: SubagentFlowEntry[];
	isError: boolean;
};

type SubagentCallDisplay = {
	id: string;
	agentId: string;
	agentLabel: string;
	taskPreview: string;
	rawArguments: Record<string, unknown>;
};

type ToolResultMessage = Extract<ChatMessage, { role: "toolResult" }>;
type AssistantMessage = Extract<ChatMessage, { role: "assistant" }>;

const assistantSubagentCalls = computed(() => {
	if (props.message.role !== "assistant") {
		return [];
	}

	return (props.message as AssistantMessage).content
		.filter(
			(block): block is { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> } =>
				block.type === "toolCall" && block.name === "run_subagent",
		)
		.map((toolCall): SubagentCallDisplay => {
			const args = asRecord(toolCall.arguments) ?? {};
			const agentId =
				pickString(args, ["agentLabel", "agentName", "agent", "agentId", "agent_id"]) || "subagent";

			return {
				id: toolCall.id,
				agentId,
				agentLabel: humanizeAgentLabel(agentId),
				taskPreview: buildTaskPreview(args),
				rawArguments: args,
			};
		});
});

const subagentToolResult = computed(() => {
	if (props.message.role !== "toolResult") {
		return null;
	}

	return extractSubagentRun(props.message as ToolResultMessage);
});

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}

	return value as Record<string, unknown>;
}

function asFlowEntry(value: unknown): SubagentFlowEntry | null {
	const record = asRecord(value);
	if (!record) {
		return null;
	}

	return {
		role: typeof record.role === "string" ? record.role : "unknown",
		content: typeof record.content === "string" ? record.content : "",
		timestamp: typeof record.timestamp === "string" ? record.timestamp : undefined,
	};
}

function pickString(record: Record<string, unknown> | undefined, keys: string[]): string {
	if (!record) {
		return "";
	}

	for (const key of keys) {
		if (typeof record[key] === "string" && record[key].trim().length > 0) {
			return record[key].trim() as string;
		}
	}

	return "";
}

function truncateText(value: string, max = 120): string {
	if (value.length <= max) {
		return value;
	}

	return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function humanizeAgentLabel(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) {
		return "Subagent";
	}

	return trimmed
		.replace(/[_-]+/g, " ")
		.replace(/\s+/g, " ")
		.replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildTaskPreview(args: Record<string, unknown> | undefined): string {
	const fullText = pickString(args, ["task", "instruction", "instructions", "prompt", "goal", "query"]);

	if (!fullText) {
		return "No task details provided.";
	}

	return truncateText(fullText, 110);
}

function extractSubagentRun(message: ToolResultMessage): SubagentRunDisplay | null {
	if (message.toolName !== "run_subagent") {
		return null;
	}

	const details = asRecord((message as ToolResultMessage & { details?: unknown }).details);
	const args = asRecord(details?.arguments);
	const flowSource = Array.isArray(details?.flow)
		? details?.flow
		: Array.isArray(details?.messages)
			? details?.messages
			: [];
	const flow = flowSource.map(asFlowEntry).filter((entry): entry is SubagentFlowEntry => Boolean(entry));
	const summaryFromDetails = typeof details?.summary === "string" ? details.summary : "";
	const summaryFromContent = extractPlainText(message.content);

	return {
		toolCallId: message.toolCallId,
		agentId:
			typeof details?.agentId === "string"
				? details.agentId
				: typeof args?.agentId === "string"
					? args.agentId
					: typeof args?.agent_id === "string"
						? args.agent_id
						: "unknown",
		agentLabel: humanizeAgentLabel(
			pickString(details, ["agentLabel", "agentName", "agent", "agentId"]) ||
				pickString(args, ["agentLabel", "agentName", "agent", "agentId", "agent_id"]) ||
				"subagent",
		),
		task:
			typeof details?.task === "string"
				? details.task
				: typeof args?.task === "string"
					? args.task
					: "",
		taskPreview: buildTaskPreview(details || args),
		summary: summaryFromDetails || summaryFromContent || "(empty response)",
		flow,
		isError: message.isError,
	};
}

function openSubagentModal(run: SubagentRunDisplay) {
	activeSubagentRun.value = run;
	showSubagentModal.value = true;
}

function closeSubagentModal() {
	showSubagentModal.value = false;
	activeSubagentRun.value = null;
}
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
					<div v-else-if="block.type === 'toolCall' && block.name !== 'run_subagent'" class="tool-block">
						<div>{{ block.name }}</div>
						<pre>{{ JSON.stringify(block.arguments, null, 2) }}</pre>
					</div>
				</template>
				<template v-for="(toolCall, toolCallIndex) in assistantSubagentCalls" :key="`${messageKey}-subagent-call-${toolCall.id}`">
					<div class="tool-block subagent-tool-call">
						<div>Subagent run {{ toolCallIndex + 1 }} · {{ toolCall.agentLabel }}</div>
						<div class="status">Task: {{ toolCall.taskPreview }}</div>
						<details>
							<summary>Technical details</summary>
							<div class="status">toolCallId: {{ toolCall.id }}</div>
							<pre>{{ JSON.stringify(toolCall.rawArguments, null, 2) }}</pre>
						</details>
					</div>
				</template>
			</template>

			<template v-else-if="message.role === 'toolResult'">
				<template v-if="subagentToolResult">
					<button type="button" class="subagent-trigger" @click="openSubagentModal(subagentToolResult)">
						{{ subagentToolResult.agentLabel }} {{ message.isError ? 'encountered an issue' : 'completed' }}. Click to inspect flow.
					</button>
					<div class="status">Task: {{ subagentToolResult.taskPreview }}</div>
					<div>{{ subagentToolResult.summary }}</div>
				</template>
				<div v-else class="tool-block">
					<div>{{ message.toolName }} {{ message.isError ? '(error)' : '' }}</div>
					<pre>{{ extractPlainText(message.content) }}</pre>
				</div>
			</template>

			<template v-else-if="isSystemNotification(message)">
				<strong>{{ message.variant === 'destructive' ? 'Alert' : 'Notice' }}</strong>
				<div>{{ message.message }}</div>
			</template>


			<div v-if="showSubagentModal && activeSubagentRun" class="modal-backdrop" @click.self="closeSubagentModal">
				<section class="modal-content">
					<header class="modal-header">
						<strong>Subagent flow · {{ activeSubagentRun.agentId }}</strong>
						<button type="button" class="modal-close" @click="closeSubagentModal">close</button>
					</header>
					<div class="modal-meta"><strong>toolCallId:</strong> {{ activeSubagentRun.toolCallId }}</div>
					<div class="modal-meta"><strong>Task:</strong> {{ activeSubagentRun.task || '(not provided)' }}</div>
					<div class="modal-meta"><strong>Summary:</strong> {{ activeSubagentRun.summary }}</div>
					<div class="modal-flow">
						<article v-for="(entry, entryIndex) in activeSubagentRun.flow" :key="`${messageKey}-flow-${entryIndex}`" class="flow-row">
							<div class="flow-role">{{ entry.role }}</div>
							<div class="flow-content">{{ entry.content || '(empty)' }}</div>
						</article>
					</div>
				</section>
			</div>

		</div>
	</article>
</template>

<style scoped>
.message-row {
	display: grid;
	grid-template-columns: 7rem minmax(0, 1fr);
	gap: 0.75rem;
	align-items: start;
	padding: 0.65rem 0.8rem;
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
	padding-top: 0.1rem;
}

.message-body {
	display: grid;
	gap: 0.5rem;
	white-space: pre-wrap;
	word-break: break-word;
}

.tool-block,
details {
	padding: 0.55rem 0.7rem;
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
	font-size: 0.8rem;
}

.subagent-trigger {
	border: 1px solid rgba(100, 255, 140, 0.45);
	background: rgba(9, 22, 12, 0.85);
	color: #9cffb2;
	padding: 0.35rem 0.5rem;
	text-align: left;
	cursor: pointer;
}

.modal-backdrop {
	position: fixed;
	inset: 0;
	background: rgba(0, 0, 0, 0.7);
	display: grid;
	place-items: center;
	padding: 1rem;
	z-index: 1000;
}

.modal-content {
	width: min(56rem, 95vw);
	max-height: 85vh;
	overflow: auto;
	border: 1px solid rgba(100, 255, 140, 0.35);
	background: rgba(7, 17, 10, 0.98);
	padding: 1rem;
	display: grid;
	gap: 0.75rem;
}

.modal-header {
	display: flex;
	justify-content: space-between;
	gap: 0.8rem;
	align-items: center;
}

.modal-close {
	border: 1px solid rgba(100, 255, 140, 0.35);
	background: transparent;
	color: inherit;
	padding: 0.25rem 0.5rem;
	cursor: pointer;
}

.modal-meta {
	padding: 0.6rem;
	border: 1px solid rgba(100, 255, 140, 0.14);
	background: rgba(9, 22, 12, 0.7);
}

.modal-flow {
	display: grid;
	gap: 0.55rem;
}

.flow-row {
	padding: 0.55rem;
	border: 1px solid rgba(100, 255, 140, 0.12);
	background: rgba(5, 12, 7, 0.8);
}

.flow-role {
	text-transform: uppercase;
	font-size: 0.75rem;
	opacity: 0.78;
	margin-bottom: 0.2rem;
}

.flow-content {
	white-space: pre-wrap;
}

@media (max-width: 720px) {
	.message-row {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
}
</style>
