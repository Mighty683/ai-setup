import type { AgentEvent } from "@mariozechner/pi-agent-core";
import type { Ref } from "vue";

import { streamAgentRun } from "~src/modules/chat/modules/agents/services/backendAgent";
import { fileToPendingImage } from "~src/modules/chat/modules/chat/shared/helpers/images";
import type { ChatMessage, PendingImage, ThinkingLevel } from "~src/modules/chat/modules/chat/shared/types/chat";
import {
	buildPromptPayload,
	pickPastedImageFiles,
	pickSupportedImageFiles,
} from "~src/modules/chat/modules/chat/composables/chat";

type CreateComposerActionsOptions = {
	messages: Ref<ChatMessage[]>;
	isStreaming: Ref<boolean>;
	composerText: Ref<string>;
	errorMessage: Ref<string | undefined>;
	pendingImages: Ref<PendingImage[]>;
	selectedModelId: Ref<string>;
	selectedThinkingLevel: Ref<ThinkingLevel>;
	selectedOpencodeAgentId: Ref<string | undefined>;
	onConversationSettled?: () => void;
};

export function createComposerActions(options: CreateComposerActionsOptions) {
	let activeAbortController: AbortController | undefined;

	async function sendMessage() {
		if (options.isStreaming.value) {
			return;
		}

		const { content, images } = buildPromptPayload(options.composerText.value, options.pendingImages.value);
		if (!content && images.length === 0) {
			return;
		}

		const userMessage: ChatMessage = {
			role: "user",
			content: buildUserContent(content, images),
			timestamp: Date.now(),
		};

		const runMessages = [...options.messages.value, userMessage];
		options.messages.value = runMessages;
		options.composerText.value = "";
		options.errorMessage.value = undefined;
		options.isStreaming.value = true;
		options.pendingImages.value = [];
		activeAbortController = new AbortController();

		try {
			await streamAgentRun(
				{
					agentId: options.selectedOpencodeAgentId.value || "default",
					modelId: options.selectedModelId.value,
					thinkingLevel: options.selectedThinkingLevel.value,
					messages: runMessages,
				},
				{
					signal: activeAbortController.signal,
					onEvent: (event) => {
						if (event.type === "agent_event") {
							applyAgentEvent(options.messages, event.event);
							return;
						}
						if (event.type === "run_failed" || event.type === "run_aborted") {
							options.errorMessage.value = event.error;
						}
					},
				},
			);
		} catch (error) {
			if (!activeAbortController.signal.aborted) {
				options.errorMessage.value = error instanceof Error ? error.message : "Message failed";
			}
		} finally {
			options.isStreaming.value = false;
			activeAbortController = undefined;
			options.onConversationSettled?.();
		}
	}

	function abortStream() {
		activeAbortController?.abort();
		options.isStreaming.value = false;
	}

	function setComposerText(value: string) {
		options.composerText.value = value;
	}

	function onComposerKeydown(event: KeyboardEvent) {
		if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
			event.preventDefault();
			void sendMessage();
		}
	}

	async function addPendingImages(files: File[]) {
		if (files.length === 0) {
			return;
		}

		const { imageFiles, hasUnsupportedFiles } = pickSupportedImageFiles(files);
		if (hasUnsupportedFiles) {
			options.errorMessage.value = "Only image files are supported.";
		}

		if (imageFiles.length === 0) {
			return;
		}

		try {
			const nextImages = await Promise.all(imageFiles.map(fileToPendingImage));
			options.pendingImages.value = [...options.pendingImages.value, ...nextImages];
		} catch (error) {
			options.errorMessage.value = error instanceof Error ? error.message : "Image upload failed";
		}
	}

	async function onImageSelect(event: Event) {
		const input = event.target as HTMLInputElement | null;
		const files = input?.files ? Array.from(input.files) : [];
		await addPendingImages(files);

		if (input) {
			input.value = "";
		}
	}

	function onComposerPaste(event: ClipboardEvent) {
		const imageFiles = pickPastedImageFiles(event);
		if (imageFiles.length === 0) {
			return;
		}

		void addPendingImages(imageFiles);
	}

	function removePendingImage(imageId: string) {
		options.pendingImages.value = options.pendingImages.value.filter((item) => item.id !== imageId);
	}

	return {
		sendMessage,
		abortStream,
		setComposerText,
		onComposerKeydown,
		onImageSelect,
		onComposerPaste,
		removePendingImage,
	};
}

function buildUserContent(content: string, images: Array<Pick<PendingImage, "data" | "mimeType" | "type">>) {
	const blocks = [] as Array<{ type: "text"; text: string } | Pick<PendingImage, "data" | "mimeType" | "type">>;
	if (content.trim()) {
		blocks.push({ type: "text", text: content.trim() });
	}
	blocks.push(...images);
	return blocks.length === 1 && blocks[0]?.type === "text" ? blocks[0].text : blocks;
}

function applyAgentEvent(messages: Ref<ChatMessage[]>, event: AgentEvent) {
	if (event.type === "message_end") {
		messages.value = [...messages.value, event.message as ChatMessage];
	}
}
