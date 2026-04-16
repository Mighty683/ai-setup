import type { AgentMessage } from "@mariozechner/pi-agent-core";

export function messageTimestamp(message: AgentMessage): string {
	if (!message || typeof message !== "object") {
		return "";
	}

	if ("timestamp" in message) {
		const stamp = message.timestamp;
		if (typeof stamp === "number") {
			return new Date(stamp).toLocaleTimeString();
		}
		if (typeof stamp === "string") {
			return new Date(stamp).toLocaleTimeString();
		}
	}

	return "";
}
