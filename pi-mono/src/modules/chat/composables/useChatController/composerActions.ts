import type { Agent } from "@mariozechner/pi-agent-core";
import type { Ref } from "vue";
import { fileToPendingImage } from "~src/core/chat/helpers/images";
import type { PendingImage } from "~src/core/chat/types/chat";
import { buildPromptPayload, pickPastedImageFiles, pickSupportedImageFiles } from "~src/modules/chat/composables/useChatController/chat";

type CreateComposerActionsOptions = {
	getAgent: () => Agent | undefined;
	isStreaming: Ref<boolean>;
	composerText: Ref<string>;
	errorMessage: Ref<string | undefined>;
	pendingImages: Ref<PendingImage[]>;
};

export function createComposerActions(options: CreateComposerActionsOptions) {
	async function sendMessage() {
		const agent = options.getAgent();
		if (!agent || options.isStreaming.value) {
			return;
		}

		const { content, images } = buildPromptPayload(options.composerText.value, options.pendingImages.value);
		if (!content && images.length === 0) {
			return;
		}

		options.composerText.value = "";
		options.errorMessage.value = undefined;
		options.isStreaming.value = true;
		try {
			await agent.prompt(content, images);
			options.pendingImages.value = [];
		} catch (error) {
			options.errorMessage.value = error instanceof Error ? error.message : "Message failed";
		} finally {
			options.isStreaming.value = Boolean(agent.state.isStreaming);
		}
	}

	function abortStream() {
		options.getAgent()?.abort();
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
