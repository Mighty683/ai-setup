<script setup lang="ts">
import UiCommandButton from "~src/core/ui/primitives/UiCommandButton.vue";
import UiField from "~src/core/ui/primitives/UiField.vue";
import UiPopoverPanel from "~src/core/ui/primitives/UiPopoverPanel.vue";
import UiTextControl from "~src/core/ui/primitives/UiTextControl.vue";

const props = withDefaults(
	defineProps<{
		open: boolean;
		mistralApiKey: string;
		hasOpenAICodexLogin: boolean;
		selectedProvider: string;
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
	(e: "openai-codex-login"): void;
	(e: "openai-codex-logout"): void;
}>();

function handleApiKeyInput(event: Event) {
	emit("api-key-input", (event.target as HTMLInputElement).value);
}

function handleThinkingLevelChange(event: Event) {
	emit("thinking-level-change", (event.target as HTMLSelectElement).value);
}
</script>

<template>
	<UiPopoverPanel :open="props.open" class="panel">
		<h3>Settings</h3>
		<UiField :for-id="props.apiKeyInputId" label="Mistral API key">
			<UiTextControl
				:id="props.apiKeyInputId"
				:value="props.mistralApiKey"
				type="password"
				placeholder="Paste VITE_MISTRAL_API_KEY or key"
				@input="handleApiKeyInput"
			/>
		</UiField>
		<UiField :for-id="props.thinkingLevelInputId" label="Thinking level">
			<UiTextControl
				as="select"
				:id="props.thinkingLevelInputId"
				:value="props.selectedThinkingLevel"
				@change="handleThinkingLevelChange"
			>
				<option v-for="level in props.thinkingLevels" :key="level" :value="level">{{ level }}</option>
			</UiTextControl>
		</UiField>
		<UiField label="OpenAI Codex login">
			<div class="oauth-controls">
				<UiCommandButton @click="emit('openai-codex-login')">login via browser</UiCommandButton>
				<UiCommandButton :disabled="!props.hasOpenAICodexLogin" @click="emit('openai-codex-logout')">
					logout
				</UiCommandButton>
				<span class="oauth-status">{{ props.hasOpenAICodexLogin ? "connected" : "not connected" }}</span>
			</div>
			<p v-if="props.selectedProvider === 'openai-codex'" class="oauth-hint">
				Use browser login for Codex models, then apply settings.
			</p>
		</UiField>
		<UiCommandButton class="apply-button" @click="emit('apply-settings')">apply settings</UiCommandButton>
	</UiPopoverPanel>
</template>

<style scoped>
.panel {
	display: grid;
	gap: 0.8rem;
}

.panel h3 {
	margin: 0 0 0.2rem;
	font-size: 0.95rem;
	text-transform: uppercase;
	letter-spacing: 0.08em;
}


.apply-button {
	justify-self: start;
}

.oauth-controls {
	display: flex;
	align-items: center;
	gap: 0.8rem;
	flex-wrap: wrap;
}

.oauth-status {
	font-size: 0.8rem;
	color: rgba(156, 255, 178, 0.7);
	text-transform: lowercase;
}

.oauth-hint {
	margin: 0;
	font-size: 0.8rem;
	color: rgba(156, 255, 178, 0.7);
}

</style>
