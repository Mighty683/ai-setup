import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { Message } from "@mariozechner/pi-ai";

export interface SystemNotificationMessage {
	role: "system-notification";
	message: string;
	variant: "default" | "destructive";
	timestamp: string;
}

declare module "@mariozechner/pi-agent-core" {
	interface CustomAgentMessages {
		"system-notification": SystemNotificationMessage;
	}
}

export function createSystemNotification(
	message: string,
	variant: "default" | "destructive" = "default",
): SystemNotificationMessage {
	return {
		role: "system-notification",
		message,
		variant,
		timestamp: new Date().toISOString(),
	};
}

export function customConvertToLlm(messages: AgentMessage[]): Message[] {
	const processed = messages.map((m): Message => {
		if (m.role === "system-notification") {
			const notification = m as SystemNotificationMessage;
			return {
				role: "user",
				content: `<system>${notification.message}</system>`,
				timestamp: Date.now(),
			};
		}

		if (m.role === "user" || m.role === "assistant" || m.role === "toolResult") {
			return m;
		}

		return {
			role: "user",
			content: "",
			timestamp: Date.now(),
		};
	});

	return processed.filter((message) => {
		if (message.role === "user") {
			if (typeof message.content === "string") {
				return message.content.trim().length > 0;
			}
			return message.content.length > 0;
		}

		if (message.role === "assistant") {
			return message.content.length > 0;
		}

		return true;
	});
}

export function extractPlainText(content: AgentMessage extends { content: infer T } ? T : unknown): string {
	if (typeof content === "string") {
		return content;
	}

	if (!Array.isArray(content)) {
		return "";
	}

	return content
		.map((block) => {
			if (!block || typeof block !== "object") {
				return "";
			}
			if ("type" in block && block.type === "text" && "text" in block) {
				return String(block.text ?? "");
			}
			if ("type" in block && block.type === "thinking" && "thinking" in block) {
				return String(block.thinking ?? "");
			}
			if ("type" in block && block.type === "toolCall" && "name" in block) {
				return `[Tool call: ${String(block.name)}]`;
			}
			return "";
		})
		.join("\n")
		.trim();
}

export function isSystemNotification(message: AgentMessage): message is SystemNotificationMessage {
	return message.role === "system-notification";
}
