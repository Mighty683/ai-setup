import type { PendingImage } from "~src/modules/chat/modules/chat/shared/types/chat";

type PromptImage = Pick<PendingImage, "data" | "mimeType" | "type">;

type PromptPayload = {
	content: string;
	images: PromptImage[];
};

type SupportedImageFiles = {
	imageFiles: File[];
	hasUnsupportedFiles: boolean;
};

export function buildPromptPayload(composerText: string, pendingImages: PendingImage[]): PromptPayload {
	return {
		content: composerText.trim(),
		images: pendingImages.map(({ data, mimeType, type }) => ({ data, mimeType, type })),
	};
}

export function pickSupportedImageFiles(files: File[]): SupportedImageFiles {
	const imageFiles = files.filter((file) => file.type.startsWith("image/"));
	return {
		imageFiles,
		hasUnsupportedFiles: imageFiles.length !== files.length,
	};
}

export function pickPastedImageFiles(event: ClipboardEvent): File[] {
	const items = event.clipboardData ? Array.from(event.clipboardData.items) : [];
	return items
		.filter((item) => item.kind === "file" && item.type.startsWith("image/"))
		.map((item) => item.getAsFile())
		.filter((file): file is File => file !== null);
}
