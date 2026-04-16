<script setup lang="ts">
import UiCommandButton from "~src/core/ui/primitives/UiCommandButton.vue";
import UiTextControl from "~src/core/ui/primitives/UiTextControl.vue";

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
			<UiCommandButton @click="emit('toggle-sessions')">sessions</UiCommandButton>
			<UiCommandButton @click="emit('start-new-session')">new</UiCommandButton>
			<template v-if="props.isEditingTitle">
				<UiTextControl
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
				<UiCommandButton @click="emit('start-editing-title')">
					{{ props.currentTitle || "Set session title" }}
				</UiCommandButton>
			</template>
		</div>

		<div class="toolbar-group toolbar-group--right">
			<UiCommandButton @click="emit('queue-notification')">notify</UiCommandButton>
			<UiCommandButton @click="emit('toggle-settings')">settings</UiCommandButton>
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

.title-edit {
	width: 100%;
}

@media (max-width: 720px) {
	.toolbar {
		display: flex;
		flex-direction: column;
	}
}
</style>
