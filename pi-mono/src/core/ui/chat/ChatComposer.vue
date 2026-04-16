<script setup lang="ts">
import { computed } from "vue";
import type { PendingImage } from "~src/core/chat/types/chat";
import type { ModelOption } from "./types";
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
		<label class="composer-label" for="composer">input</label>

		<PendingImageList :pending-images="pendingImages" @remove="handleRemovePendingImage" />

		<textarea
			id="composer"
			:value="composerText"
			placeholder="> ask something"
			:disabled="!agentReady"
			@input="handleComposerInput"
			@keydown="handleComposerKeydown"
			@paste="handleComposerPaste"
		/>

		<div class="composer-footer">
			<div class="composer-controls">
				<div class="field compact-field upload-field">
					<label for="image-upload">Images</label>
					<input id="image-upload" type="file" accept="image/*" multiple @change="handleImageSelect" />
				</div>
				<div class="field compact-field">
					<label for="provider-id">Provider</label>
					<select id="provider-id" :value="selectedProvider" disabled>
						<option v-for="provider in availableProviders" :key="provider" :value="provider">{{ provider }}</option>
					</select>
				</div>
				<div class="field compact-field">
					<label for="model-id">Model</label>
					<select id="model-id" :value="selectedModelId" @change="handleModelChange">
						<option v-for="model in safeModels" :key="model.id" :value="model.id">{{ model.id }}</option>
					</select>
				</div>
			</div>

			<div class="composer-actions">
				<button class="command" type="button" :disabled="isStreaming" @click="handleSend">send</button>
				<button class="command" type="button" :disabled="!isStreaming" @click="handleAbort">stop</button>
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

.composer-label {
	color: rgba(156, 255, 178, 0.72);
	font-size: 0.82rem;
	letter-spacing: 0.08em;
	text-transform: uppercase;
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

.field {
	display: grid;
	gap: 0.4rem;
	min-width: 0;
}

.compact-field {
	min-width: 13rem;
}

.upload-field {
	min-width: 11rem;
}

.field label {
	font-size: 0.8rem;
	color: rgba(156, 255, 178, 0.72);
	text-transform: uppercase;
	letter-spacing: 0.06em;
}

textarea,
input,
select {
	width: 100%;
	border: 1px solid rgba(100, 255, 140, 0.2);
	background: rgba(7, 17, 10, 0.96);
	color: #d6ffe0;
	font: inherit;
	outline: none;
}

input,
select {
	padding: 0.6rem 0.7rem;
}

textarea {
	min-height: 8rem;
	resize: vertical;
	padding: 0.85rem 0.95rem;
}

textarea:focus,
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

select:disabled,
textarea:disabled,
input:disabled,
.command:disabled {
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
