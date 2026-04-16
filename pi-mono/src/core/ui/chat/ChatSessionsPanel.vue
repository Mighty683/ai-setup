<script setup lang="ts">
import type { ChatSessionItem } from "./types";

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
	<section v-if="props.open" class="panel" @click.stop>
		<h3>Saved sessions</h3>
		<p v-if="props.sessions.length === 0" class="status">{{ props.emptyText }}</p>
		<div v-for="session in props.sessions" :key="session.id" class="session-item">
			<div>
				<div>{{ session.title }}</div>
				<div class="session-meta">{{ new Date(session.lastModified).toLocaleString() }} · {{ session.modelId }}</div>
			</div>
			<div class="session-actions">
				<button class="command" type="button" @click="emit('open-session', session.id)">open</button>
				<button class="command command--danger" type="button" @click="emit('delete-session', session.id)">delete</button>
			</div>
		</div>
	</section>
</template>

<style scoped>
.panel {
	position: absolute;
	top: calc(100% - 0.25rem);
	left: 1.25rem;
	z-index: 30;
	width: min(32rem, calc(100vw - 2rem));
	max-height: min(70vh, 32rem);
	overflow: auto;
	padding: 1rem;
	border: 1px solid rgba(100, 255, 140, 0.2);
	background: rgba(5, 14, 8, 0.98);
	box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
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

.command {
	padding: 0;
	border: 0;
	background: transparent;
	color: #9cffb2;
	font: inherit;
	cursor: pointer;
	text-transform: lowercase;
}

.command::before {
	content: "[";
	color: rgba(156, 255, 178, 0.45);
}

.command::after {
	content: "]";
	color: rgba(156, 255, 178, 0.45);
}

.command:hover {
	color: #d6ffe0;
	text-shadow: 0 0 10px rgba(79, 255, 122, 0.35);
}

.command--danger {
	color: #ff7d7d;
}

@media (max-width: 720px) {
	.panel {
		left: 1rem;
		right: 1rem;
		width: auto;
		max-height: min(65vh, 28rem);
	}
}
</style>
