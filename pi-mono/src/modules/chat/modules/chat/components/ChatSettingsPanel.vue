<script setup lang="ts">
import UiCommandButton from "~src/core/ui/primitives/UiCommandButton.vue";
import UiField from "~src/core/ui/primitives/UiField.vue";
import UiPopoverPanel from "~src/core/ui/primitives/UiPopoverPanel.vue";
import UiTextControl from "~src/core/ui/primitives/UiTextControl.vue";
import type { ServerAgentCatalogEntry } from "~src/modules/chat/modules/persistence/services/serverCatalog";

const props = withDefaults(
	defineProps<{
		open: boolean;
		mistralApiKey: string;
		hasOpenAICodexLogin: boolean;
		selectedProvider: string;
		selectedThinkingLevel: string;
		thinkingLevels: readonly string[];
		opencodeAgents: readonly ServerAgentCatalogEntry[];
		opencodeModels: readonly string[];
		selectedOpencodeAgentId?: string;
		apiKeyInputId?: string;
		thinkingLevelInputId?: string;
		opencodeAgentInputId?: string;
	}>(),
	{
		apiKeyInputId: "api-key",
		thinkingLevelInputId: "thinking-level",
		opencodeAgentInputId: "opencode-agent",
	},
);

const emit = defineEmits<{
	(e: "api-key-input", value: string): void;
	(e: "thinking-level-change", value: string): void;
	(e: "opencode-agent-change", value: string): void;
	(e: "apply-settings"): void;
	(e: "close"): void;
	(e: "openai-codex-login"): void;
	(e: "openai-codex-logout"): void;
}>();

function handleApiKeyInput(event: Event) {
	emit("api-key-input", (event.target as HTMLInputElement).value);
}

function handleThinkingLevelChange(event: Event) {
	emit("thinking-level-change", (event.target as HTMLSelectElement).value);
}

function handleOpencodeAgentChange(event: Event) {
	emit("opencode-agent-change", (event.target as HTMLSelectElement).value);
}
</script>

<template>
	<UiPopoverPanel :open="props.open" class="panel" @close="emit('close')">
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
		<UiField :for-id="props.opencodeAgentInputId" label="Opencode agent">
			<UiTextControl
				as="select"
				:id="props.opencodeAgentInputId"
				:value="props.selectedOpencodeAgentId"
				@change="handleOpencodeAgentChange"
			>
				<option v-for="agent in props.opencodeAgents" :key="agent.id" :value="agent.id">
					{{ agent.id }} ({{ agent.mode }})
				</option>
			</UiTextControl>
		</UiField>
		<UiField label="Opencode models">
			<div class="opencode-models">
				<span v-for="model in props.opencodeModels" :key="model">{{ model }}</span>
			</div>
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
	gap: 0.55rem;
}

.panel h3 {
	margin: 0 0 0.1rem;
	font-size: 0.86rem;
	text-transform: uppercase;
	letter-spacing: 0.07em;
}


.apply-button {
	justify-self: start;
}

.oauth-controls {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	flex-wrap: wrap;
}

.opencode-models {
	display: flex;
	flex-direction: column;
	gap: 0.12rem;
	font-size: 0.75rem;
	color: rgba(156, 255, 178, 0.75);
}

.oauth-status {
	font-size: 0.74rem;
	color: rgba(156, 255, 178, 0.7);
	text-transform: lowercase;
}

.oauth-hint {
	margin: 0;
	font-size: 0.74rem;
	color: rgba(156, 255, 178, 0.7);
}

</style>
