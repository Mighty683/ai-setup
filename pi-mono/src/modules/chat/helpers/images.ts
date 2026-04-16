import type { ImageContent } from "@mariozechner/pi-ai";
import type { PendingImage } from "../types/chat";

export function isImageContent(block: unknown): block is ImageContent {
	return Boolean(
		block &&
			typeof block === "object" &&
			"type" in block &&
			block.type === "image" &&
			"data" in block &&
			"mimeType" in block,
	);
}

export function imageSrc(image: ImageContent): string {
	return `data:${image.mimeType};base64,${image.data}`;
}

export async function fileToPendingImage(file: File): Promise<PendingImage> {
	const dataUrl = await new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
		reader.onerror = () => reject(reader.error || new Error(`Failed to read ${file.name}`));
		reader.readAsDataURL(file);
	});

	const [, data = ""] = dataUrl.split(",", 2);
	return {
		id: crypto.randomUUID(),
		name: file.name,
		previewUrl: dataUrl,
		type: "image",
		mimeType: file.type || "image/png",
		data,
	};
}
