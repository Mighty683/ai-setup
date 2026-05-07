import type { ImageContent, Message } from "@mariozechner/pi-ai";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface SystemNotificationMessage {
	role: "system-notification";
	message: string;
	variant: "default" | "destructive";
	timestamp: string;
}

export type ChatMessage = Message | SystemNotificationMessage;

export type PendingImage = ImageContent & {
	id: string;
	name: string;
	previewUrl: string;
};
