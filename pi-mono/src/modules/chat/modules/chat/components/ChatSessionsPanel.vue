<script setup lang="ts">
import type { ChatSessionItem } from "~src/modules/chat/modules/chat/types/ui";
import UiCommandButton from "~src/core/ui/primitives/UiCommandButton.vue";
import UiPopoverPanel from "~src/core/ui/primitives/UiPopoverPanel.vue";

const props = withDefaults(
	defineProps<{
		open: boolean;
		sessions: readonly ChatSessionItem[];
		emptyText?: string;
	}>(),
	{
		emptyText: "No saved sessions yet.",
	},
);

const emit = defineEmits<{
	(e: "open-session", sessionId: string): void;
	(e: "delete-session", sessionId: string): void;
}>();
</script>

<template>
	<UiPopoverPanel :open="props.open" class="panel">
		<h3>Saved sessions</h3>
		<p v-if="props.sessions.length === 0" class="status">{{ props.emptyText }}</p>
		<div v-for="session in props.sessions" :key="session.id" class="session-item">
			<div>
				<div>{{ session.title }}</div>
				<div class="session-meta">{{ new Date(session.lastModified).toLocaleString() }} · {{ session.modelId }}</div>
			</div>
			<div class="session-actions">
				<UiCommandButton @click="emit('open-session', session.id)">open</UiCommandButton>
				<UiCommandButton tone="danger" @click="emit('delete-session', session.id)">delete</UiCommandButton>
			</div>
		</div>
	</UiPopoverPanel>
</template>

<style scoped>
.panel {
}

.panel h3 {
	margin: 0 0 1rem;
	font-size: 0.95rem;
	text-transform: uppercase;
	letter-spacing: 0.08em;
}

.session-item {
	display: flex;
	justify-content: space-between;
	gap: 1rem;
	padding: 0.85rem 0;
	border-top: 1px solid rgba(100, 255, 140, 0.12);
}

.session-item:first-of-type {
	border-top: 0;
	padding-top: 0;
}

.session-actions {
	display: flex;
	gap: 0.75rem;
	align-items: flex-start;
}

.session-meta,
.status {
	color: rgba(156, 255, 178, 0.68);
	font-size: 0.84rem;
}

</style>
