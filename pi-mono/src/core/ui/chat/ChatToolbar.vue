<script setup lang="ts">
const props = withDefaults(
	defineProps<{
		brand?: string;
		currentTitle: string;
		isEditingTitle: boolean;
		editableTitle: string;
	}>(),
	{
		brand: "pi-mono://console",
	},
);

const emit = defineEmits<{
	(e: "toggle-sessions"): void;
	(e: "start-new-session"): void;
	(e: "start-editing-title"): void;
	(e: "editable-title-input", value: string): void;
	(e: "title-edit-keydown", event: KeyboardEvent): void;
	(e: "save-title"): void;
	(e: "queue-notification"): void;
	(e: "toggle-settings"): void;
}>();

function handleEditableTitleInput(event: Event) {
	emit("editable-title-input", (event.target as HTMLInputElement).value);
}

function handleTitleEditKeydown(event: KeyboardEvent) {
	emit("title-edit-keydown", event);
}
</script>

<template>
	<header class="toolbar">
		<div class="toolbar-group toolbar-group--left">
			<div class="brand">{{ props.brand }}</div>
			<button class="command" type="button" @click="emit('toggle-sessions')">sessions</button>
			<button class="command" type="button" @click="emit('start-new-session')">new</button>
			<template v-if="props.isEditingTitle">
				<input
					:value="props.editableTitle"
					class="title-edit"
					type="text"
					placeholder="Session title"
					@input="handleEditableTitleInput"
					@keydown="handleTitleEditKeydown"
					@blur="emit('save-title')"
				/>
			</template>
			<template v-else>
				<button class="title" type="button" @click="emit('start-editing-title')">
					{{ props.currentTitle || "Pi Mono Vue" }}
				</button>
			</template>
		</div>

		<div class="toolbar-group toolbar-group--right">
			<button class="command" type="button" @click="emit('queue-notification')">notify</button>
			<button class="command" type="button" @click="emit('toggle-settings')">settings</button>
		</div>

		<slot />
	</header>
</template>

<style scoped>
.toolbar {
	position: relative;
	z-index: 20;
	display: flex;
	justify-content: space-between;
	align-items: flex-start;
	gap: 1rem;
	flex-wrap: wrap;
	padding: 1rem 1.25rem;
	border-bottom: 1px solid rgba(100, 255, 140, 0.18);
	background: rgba(5, 14, 8, 0.94);
	backdrop-filter: blur(10px);
}

.toolbar-group {
	display: flex;
	align-items: center;
	gap: 0.85rem;
	flex-wrap: wrap;
}

.brand {
	color: #4fff7a;
	font-size: 0.84rem;
	letter-spacing: 0.12em;
	text-transform: uppercase;
}

.command,
.title {
	padding: 0;
	border: 0;
	background: transparent;
	color: #9cffb2;
	font: inherit;
	cursor: pointer;
	text-transform: lowercase;
}

.command::before,
.title::before {
	content: "[";
	color: rgba(156, 255, 178, 0.45);
}

.command::after,
.title::after {
	content: "]";
	color: rgba(156, 255, 178, 0.45);
}

.command:hover,
.title:hover {
	color: #d6ffe0;
	text-shadow: 0 0 10px rgba(79, 255, 122, 0.35);
}

.title-edit {
	width: 100%;
	padding: 0.6rem 0.7rem;
	border: 1px solid rgba(100, 255, 140, 0.2);
	background: rgba(7, 17, 10, 0.96);
	color: #d6ffe0;
	font: inherit;
	outline: none;
}

.title-edit:focus {
	border-color: rgba(79, 255, 122, 0.65);
	box-shadow: 0 0 0 1px rgba(79, 255, 122, 0.18);
}

@media (max-width: 720px) {
	.toolbar {
		display: flex;
		flex-direction: column;
	}
}
</style>
