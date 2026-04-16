import type { ImageContent } from "@mariozechner/pi-ai";

export type PendingImage = ImageContent & {
	id: string;
	name: string;
	previewUrl: string;
};
