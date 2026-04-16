<script setup lang="ts">
import { computed } from "vue";
import type { PendingImage } from "~src/modules/chat/modules/chat/shared/types/chat";
import UiCommandButton from "~src/core/ui/primitives/UiCommandButton.vue";
import UiField from "~src/core/ui/primitives/UiField.vue";
import UiTextControl from "~src/core/ui/primitives/UiTextControl.vue";
import type { ModelOption } from "~src/modules/chat/modules/chat/types/ui";
import PendingImageList from "./PendingImageList.vue";

const props = defineProps<{
	composerText: string;
	agentReady: boolean;
	pendingImages: readonly PendingImage[];
	availableProviders: readonly string[];
	selectedProvider: string;
	selectedModelId: string;
	models: readonly ModelOption[];
	isStreaming: boolean;
}>();

const emit = defineEmits<{
	"update:composerText": [value: string];
	composerKeydown: [event: KeyboardEvent];
	composerPaste: [event: ClipboardEvent];
	imageSelect: [event: Event];
	providerChange: [provider: string];
	modelChange: [modelId: string];
	applyQuickModelSettings: [];
	send: [];
	abort: [];
	removePendingImage: [imageId: string];
}>();

const safeModels = computed<ModelOption[]>(() => {
	if (!Array.isArray(props.models)) {
		return [];
	}

	return (props.models as unknown[])
		.map((model) => {
			if (!model || typeof model !== "object") {
				return null;
			}

			const { id } = model as { id?: unknown };
			return typeof id === "string" ? { id } : null;
		})
		.filter((model): model is ModelOption => model !== null);
});

function handleComposerInput(event: Event) {
	emit("update:composerText", (event.target as HTMLTextAreaElement).value);
}

function handleComposerKeydown(event: KeyboardEvent) {
	emit("composerKeydown", event);
}

function handleComposerPaste(event: ClipboardEvent) {
	emit("composerPaste", event);
}

function handleImageSelect(event: Event) {
	emit("imageSelect", event);
}

function handleModelChange(event: Event) {
	emit("modelChange", (event.target as HTMLSelectElement).value);
	emit("applyQuickModelSettings");
}

function handleProviderChange(event: Event) {
	emit("providerChange", (event.target as HTMLSelectElement).value);
	emit("applyQuickModelSettings");
}

function handleSend() {
	emit("send");
}

function handleAbort() {
	emit("abort");
}

function handleRemovePendingImage(imageId: string) {
	emit("removePendingImage", imageId);
}
</script>

<template>
	<section class="composer">
		<UiField class="composer-input" label="input" for-id="composer">
			<UiTextControl
				as="textarea"
				id="composer"
				:value="composerText"
				placeholder="> ask something"
				:disabled="!agentReady"
				@input="handleComposerInput"
				@keydown="handleComposerKeydown"
				@paste="handleComposerPaste"
			/>
		</UiField>

		<PendingImageList :pending-images="pendingImages" @remove="handleRemovePendingImage" />

		<div class="composer-footer">
			<div class="composer-controls">
				<UiField class="compact-field upload-field" label="Images" for-id="image-upload">
					<UiTextControl id="image-upload" type="file" accept="image/*" multiple @change="handleImageSelect" />
				</UiField>
				<UiField class="compact-field" label="Provider" for-id="provider-id">
					<UiTextControl as="select" id="provider-id" :value="selectedProvider" @change="handleProviderChange">
						<option v-for="provider in availableProviders" :key="provider" :value="provider">{{ provider }}</option>
					</UiTextControl>
				</UiField>
				<UiField class="compact-field" label="Model" for-id="model-id">
					<UiTextControl as="select" id="model-id" :value="selectedModelId" @change="handleModelChange">
						<option v-for="model in safeModels" :key="model.id" :value="model.id">{{ model.id }}</option>
					</UiTextControl>
				</UiField>
			</div>

			<div class="composer-actions">
				<UiCommandButton :disabled="isStreaming" @click="handleSend">send</UiCommandButton>
				<UiCommandButton :disabled="!isStreaming" @click="handleAbort">stop</UiCommandButton>
			</div>
		</div>

		<div class="composer-hint">Ctrl/Cmd + Enter to send</div>
	</section>
</template>

<style scoped>
.composer {
	display: grid;
	gap: 0.85rem;
	padding: 1rem;
	border: 1px solid rgba(100, 255, 140, 0.18);
	background: rgba(5, 14, 8, 0.94);
}

.composer-input {
	gap: 0.85rem;
}

.composer-hint {
	color: rgba(156, 255, 178, 0.68);
	font-size: 0.84rem;
}

.composer-footer {
	display: flex;
	justify-content: space-between;
	gap: 1rem;
	align-items: end;
	flex-wrap: wrap;
}

.composer-controls,
.composer-actions {
	display: flex;
	gap: 1rem;
	flex-wrap: wrap;
}

.compact-field {
	min-width: 13rem;
}

.upload-field {
	min-width: 11rem;
}

.composer :deep(input[type="file"]),
.composer :deep(select),
.composer :deep(textarea) {
	width: 100%;
}

.composer :deep(input:disabled),
.composer :deep(select:disabled),
.composer :deep(textarea:disabled),
.composer-actions :deep(.ui-command-button:disabled) {
	opacity: 0.45;
	cursor: not-allowed;
}

@media (max-width: 720px) {
	.composer-footer {
		display: flex;
		flex-direction: column;
	}
}
</style>
