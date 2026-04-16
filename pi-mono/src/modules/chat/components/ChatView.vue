<script setup lang="ts">
import type { AgentMessage, ThinkingLevel } from "@mariozechner/pi-agent-core";
import { computed, nextTick, ref, watch } from "vue";
import type { PendingImage, StoredSession } from "../types/chat";
import { extractPlainText, isSystemNotification } from "../utils/custom-messages";
import { imageSrc, isImageContent } from "../helpers/images";
import { messageTimestamp } from "../helpers/messages";

type ModelOption = { id: string };

const props = defineProps<{
	availableProviders: readonly string[];
	thinkingLevels: ThinkingLevel[];
	hasMessages: boolean;
	models: ModelOption[];
	agentReady: boolean;
	currentTitle: string;
	isEditingTitle: boolean;
	editableTitle: string;
	showSessions: boolean;
	showSettings: boolean;
	sessions: StoredSession[];
	composerText: string;
	mistralApiKey: string;
	selectedProvider: string;
	selectedModelId: string;
	selectedThinkingLevel: ThinkingLevel;
	messages: AgentMessage[];
	isStreaming: boolean;
	errorMessage?: string;
	pendingImages: PendingImage[];
	onToggleSessions: () => void;
	onToggleSettings: () => void;
	onStartNewSession: () => Promise<void>;
	onStartEditingTitle: () => void;
	onEditableTitleChange: (value: string) => void;
	onTitleEditKeydown: (event: KeyboardEvent) => void;
	onSaveTitle: () => void;
	onQueueSystemNotification: () => void;
	onLoadSession: (sessionId: string) => Promise<void>;
	onRemoveSession: (sessionId: string) => void;
	onMistralApiKeyChange: (value: string) => void;
	onThinkingLevelChange: (value: ThinkingLevel) => void;
	onApplySettings: () => void;
	onImageSelect: (event: Event) => Promise<void>;
	onModelChange: (modelId: string) => void;
	onApplyQuickModelSettings: () => void;
	onComposerTextChange: (value: string) => void;
	onComposerKeydown: (event: KeyboardEvent) => void;
	onSendMessage: () => Promise<void>;
	onAbortStream: () => void;
	onRemovePendingImage: (imageId: string) => void;
}>();

const messagesContainer = ref<HTMLElement | null>(null);
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

watch(
	() => props.messages.length,
	() => {
		nextTick(() => {
			if (!messagesContainer.value) {
				return;
			}
			messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
		});
	},
);

function handleEditableTitleInput(event: Event) {
	props.onEditableTitleChange((event.target as HTMLInputElement).value);
}

function handleApiKeyInput(event: Event) {
	props.onMistralApiKeyChange((event.target as HTMLInputElement).value);
}

function handleThinkingLevelChange(event: Event) {
	props.onThinkingLevelChange((event.target as HTMLSelectElement).value as ThinkingLevel);
}

function handleComposerInput(event: Event) {
	props.onComposerTextChange((event.target as HTMLTextAreaElement).value);
}

function handleModelChange(event: Event) {
	props.onModelChange((event.target as HTMLSelectElement).value);
	props.onApplyQuickModelSettings();
}
</script>

<template>
	<div class="shell">
		<header class="toolbar">
			<div class="toolbar-group toolbar-group--left">
				<div class="brand">pi-mono://console</div>
				<button class="command" type="button" @click="onToggleSessions">sessions</button>
				<button class="command" type="button" @click="onStartNewSession">new</button>
				<template v-if="isEditingTitle">
					<input
						:value="editableTitle"
						class="title-edit"
						type="text"
						placeholder="Session title"
						@input="handleEditableTitleInput"
						@keydown="onTitleEditKeydown"
						@blur="onSaveTitle"
					/>
				</template>
				<template v-else>
					<button class="title" type="button" @click="onStartEditingTitle">
						{{ currentTitle || "Pi Mono Vue" }}
					</button>
				</template>
			</div>
			<div class="toolbar-group toolbar-group--right">
				<button class="command" type="button" @click="onQueueSystemNotification">notify</button>
				<button class="command" type="button" @click="onToggleSettings">settings</button>
			</div>

			<section v-if="showSessions" class="panel" @click.stop>
				<h3>Saved sessions</h3>
				<p v-if="sessions.length === 0" class="status">No saved sessions yet.</p>
				<div v-for="session in sessions" :key="session.id" class="session-item">
					<div>
						<div>{{ session.title }}</div>
						<div class="session-meta">
							{{ new Date(session.lastModified).toLocaleString() }} · {{ session.modelId }}
						</div>
					</div>
					<div class="session-actions">
						<button class="command" type="button" @click="onLoadSession(session.id)">open</button>
						<button class="command command--danger" type="button" @click="onRemoveSession(session.id)">delete</button>
					</div>
				</div>
			</section>

			<section v-if="showSettings" class="panel" @click.stop>
				<h3>Settings</h3>
				<div class="field">
					<label for="api-key">Mistral API key</label>
					<input
						id="api-key"
						:value="mistralApiKey"
						type="password"
						placeholder="Paste VITE_MISTRAL_API_KEY or key"
						@input="handleApiKeyInput"
					/>
				</div>
				<div class="field">
					<label for="thinking-level">Thinking level</label>
					<select id="thinking-level" :value="selectedThinkingLevel" @change="handleThinkingLevelChange">
						<option v-for="level in thinkingLevels" :key="level" :value="level">{{ level }}</option>
					</select>
				</div>
				<button class="command" type="button" @click="onApplySettings">apply settings</button>
			</section>
		</header>

		<main class="content">
			<section class="intro">
				<div class="prompt-line">&gt; terminal chat ready</div>
				<div class="intro-meta">
					<span>provider: {{ selectedProvider }}</span>
					<span>model: {{ selectedModelId }}</span>
					<span>thinking: {{ selectedThinkingLevel }}</span>
				</div>
			</section>

			<section ref="messagesContainer" class="messages">
				<div v-if="!hasMessages" class="status">Start a conversation. Press Ctrl/Cmd + Enter to send from the composer.</div>
				<article
					v-for="(message, index) in messages"
					:key="`${index}-${message.role}`"
					:class="['message-row', message.role, isSystemNotification(message) ? message.variant : '']"
				>
					<div class="message-label">{{ message.role }}</div>
					<div class="message-body">
						<template v-if="message.role === 'user'">
							<template v-if="typeof message.content === 'string'">
								{{ message.content }}
							</template>
							<template v-else>
								<template v-for="(block, blockIndex) in message.content" :key="`${index}-user-${blockIndex}`">
									<div v-if="block.type === 'text'">{{ block.text }}</div>
									<img v-else-if="isImageContent(block)" class="message-image" :src="imageSrc(block)" alt="Uploaded image" />
								</template>
							</template>
						</template>
						<template v-else-if="message.role === 'assistant'">
							<template v-for="(block, blockIndex) in message.content" :key="`${index}-${blockIndex}`">
								<div v-if="block.type === 'text'">{{ block.text }}</div>
								<details v-else-if="block.type === 'thinking'">
									<summary>Reasoning</summary>
									<div>{{ block.thinking }}</div>
								</details>
								<div v-else-if="block.type === 'toolCall'" class="tool-block">
									<div>{{ block.name }}</div>
									<pre>{{ JSON.stringify(block.arguments, null, 2) }}</pre>
								</div>
							</template>
						</template>
						<template v-else-if="message.role === 'toolResult'">
							<div class="tool-block">
								<div>{{ message.toolName }} {{ message.isError ? '(error)' : '' }}</div>
								<pre>{{ extractPlainText(message.content) }}</pre>
							</div>
						</template>
						<template v-else-if="isSystemNotification(message)">
							<strong>{{ message.variant === 'destructive' ? 'Alert' : 'Notice' }}</strong>
							<div>{{ message.message }}</div>
						</template>
						<div v-if="messageTimestamp(message)" class="status timestamp">{{ messageTimestamp(message) }}</div>
					</div>
				</article>
				<div v-if="isStreaming" class="status streaming">assistant is responding...</div>
				<div v-if="errorMessage" class="status">{{ errorMessage }}</div>
			</section>

			<section class="composer">
				<label class="composer-label" for="composer">input</label>
				<div v-if="pendingImages.length > 0" class="pending-images">
					<div v-for="image in pendingImages" :key="image.id" class="pending-image-card">
						<img class="pending-image-preview" :src="image.previewUrl" :alt="image.name" />
						<div class="pending-image-meta">
							<div>{{ image.name }}</div>
							<button class="command" type="button" @click="onRemovePendingImage(image.id)">remove</button>
						</div>
					</div>
				</div>

				<textarea
					id="composer"
					:value="composerText"
					placeholder="> ask something"
					:disabled="!agentReady"
					@input="handleComposerInput"
					@keydown="onComposerKeydown"
				/>

				<div class="composer-footer">
					<div class="composer-controls">
						<div class="field compact-field upload-field">
							<label for="image-upload">Images</label>
							<input id="image-upload" type="file" accept="image/*" multiple @change="onImageSelect" />
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
						<button class="command" type="button" :disabled="isStreaming" @click="onSendMessage">send</button>
						<button class="command" type="button" :disabled="!isStreaming" @click="onAbortStream">stop</button>
					</div>
				</div>
				<div class="composer-hint">Ctrl/Cmd + Enter to send</div>
			</section>
		</main>
	</div>
</template>
