<script setup lang="ts">
const props = withDefaults(
	defineProps<{
		open: boolean;
		mistralApiKey: string;
		selectedThinkingLevel: string;
		thinkingLevels: readonly string[];
		apiKeyInputId?: string;
		thinkingLevelInputId?: string;
	}>(),
	{
		apiKeyInputId: "api-key",
		thinkingLevelInputId: "thinking-level",
	},
);

const emit = defineEmits<{
	(e: "api-key-input", value: string): void;
	(e: "thinking-level-change", value: string): void;
	(e: "apply-settings"): void;
}>();

function handleApiKeyInput(event: Event) {
	emit("api-key-input", (event.target as HTMLInputElement).value);
}

function handleThinkingLevelChange(event: Event) {
	emit("thinking-level-change", (event.target as HTMLSelectElement).value);
}
</script>

<template>
	<section v-if="props.open" class="panel" @click.stop>
		<h3>Settings</h3>
		<div class="field">
			<label :for="props.apiKeyInputId">Mistral API key</label>
			<input
				:id="props.apiKeyInputId"
				:value="props.mistralApiKey"
				type="password"
				placeholder="Paste VITE_MISTRAL_API_KEY or key"
				@input="handleApiKeyInput"
			/>
		</div>
		<div class="field">
			<label :for="props.thinkingLevelInputId">Thinking level</label>
			<select :id="props.thinkingLevelInputId" :value="props.selectedThinkingLevel" @change="handleThinkingLevelChange">
				<option v-for="level in props.thinkingLevels" :key="level" :value="level">{{ level }}</option>
			</select>
		</div>
		<button class="command" type="button" @click="emit('apply-settings')">apply settings</button>
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
	display: grid;
	gap: 0.8rem;
}

.panel h3 {
	margin: 0 0 0.2rem;
	font-size: 0.95rem;
	text-transform: uppercase;
	letter-spacing: 0.08em;
}

.field {
	display: grid;
	gap: 0.4rem;
	min-width: 0;
}

.field label {
	font-size: 0.8rem;
	color: rgba(156, 255, 178, 0.72);
	text-transform: uppercase;
	letter-spacing: 0.06em;
}

input,
select {
	width: 100%;
	padding: 0.6rem 0.7rem;
	border: 1px solid rgba(100, 255, 140, 0.2);
	background: rgba(7, 17, 10, 0.96);
	color: #d6ffe0;
	font: inherit;
	outline: none;
}

input:focus,
select:focus {
	border-color: rgba(79, 255, 122, 0.65);
	box-shadow: 0 0 0 1px rgba(79, 255, 122, 0.18);
}

.command {
	padding: 0;
	border: 0;
	background: transparent;
	color: #9cffb2;
	font: inherit;
	cursor: pointer;
	text-transform: lowercase;
	justify-self: start;
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

@media (max-width: 720px) {
	.panel {
		left: 1rem;
		right: 1rem;
		width: auto;
		max-height: min(65vh, 28rem);
	}
}
</style>
