import type { AgentEvent } from "@mariozechner/pi-agent-core";

import type { ChatMessage, ThinkingLevel } from "~src/modules/chat/modules/chat/shared/types/chat";

type AgentRunStreamEvent =
	| { type: "agent_event"; event: AgentEvent }
	| { type: "run_completed" }
	| { type: "run_failed"; error: string }
	| { type: "run_aborted"; error: string };

export type AgentRunRequest = {
	agentId: string;
	modelId: string;
	thinkingLevel: ThinkingLevel;
	messages: ChatMessage[];
};

export async function streamAgentRun(
	request: AgentRunRequest,
	options: {
		signal?: AbortSignal;
		onEvent: (event: AgentRunStreamEvent) => void;
	},
): Promise<void> {
	const response = await fetch("/api/agent/run", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(request),
		signal: options.signal,
	});

	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(`Backend run failed (${response.status}): ${text || response.statusText}`);
	}

	if (!response.body) {
		throw new Error("Backend run returned no body.");
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}

		buffer += decoder.decode(value, { stream: true });
		const chunks = buffer.split("\n\n");
		buffer = chunks.pop() || "";

		for (const chunk of chunks) {
			for (const line of chunk.split("\n")) {
				if (!line.startsWith("data: ")) {
					continue;
				}
				const payload = line.slice(6).trim();
				if (!payload) {
					continue;
				}
				options.onEvent(JSON.parse(payload) as AgentRunStreamEvent);
			}
		}
	}
}
