import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { extractPlainText } from "~src/modules/chat/modules/chat/shared/utils/custom-messages";

export function generateTitle(agentMessages: AgentMessage[]): string {
	const firstUserMessage = agentMessages.find((message) => message.role === "user");
	if (!firstUserMessage || firstUserMessage.role !== "user") {
		return "Untitled chat";
	}

	const text = extractPlainText(firstUserMessage.content).trim();
	if (!text) {
		return "Untitled chat";
	}

	const sentenceEnd = text.search(/[.!?]/);
	if (sentenceEnd > 0 && sentenceEnd <= 56) {
		return text.slice(0, sentenceEnd + 1);
	}

	return text.length <= 56 ? text : `${text.slice(0, 53)}...`;
}
