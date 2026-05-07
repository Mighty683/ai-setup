import type { AgentEvent } from "@mariozechner/pi-agent-core";
import type { ImageContent, Message } from "@mariozechner/pi-ai";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type SystemNotificationMessage = {
	role: "system-notification";
	message: string;
	variant: "default" | "destructive";
	timestamp: string;
};

export type ClientChatMessage = Message | SystemNotificationMessage;

export type AgentRunRequestBody = {
	agentId: string;
	modelId: string;
	thinkingLevel?: ThinkingLevel;
	messages: ClientChatMessage[];
};

export type AgentCatalogResponse = {
	agents: Array<{
		id: string;
		model: string;
		mode: "primary" | "subagent";
		role: string;
		prompt: string;
	}>;
	models: string[];
	providers: string[];
	defaultAgentId: string;
	defaultModelId: string;
	thinkingLevels: ThinkingLevel[];
};

export type AgentEventEnvelope = {
	type: "agent_event";
	event: AgentEvent;
};

export type AgentTerminalEnvelope =
	| { type: "run_completed" }
	| { type: "run_failed"; error: string }
	| { type: "run_aborted"; error: string };

export type AgentRunStreamEvent = AgentEventEnvelope | AgentTerminalEnvelope;

export type PromptImage = Pick<ImageContent, "data" | "mimeType" | "type">;
