import type { IncomingMessage, ServerResponse } from "node:http";
import type { Model, SimpleStreamOptions } from "@mariozechner/pi-ai";

export type SubagentRunRequestBody = {
	agentId: string;
	task: string;
	mistralApiKey?: string;
	openAIAccessToken?: string;
	thinkingLevel?: SimpleStreamOptions["reasoning"];
};

export type SubagentFlowEntry = {
	role: string;
	content: string;
	timestamp?: string;
};

export type SubagentRunResponse = {
	toolCallId?: string;
	agentId: string;
	task: string;
	summary: string;
	status: "completed" | "failed";
	errorMessage?: string;
	flow: SubagentFlowEntry[];
};

export type OpencodeAgentProfile = {
	id: string;
	model: string;
	mode: "primary" | "subagent";
	prompt?: string;
	permission?: unknown;
};

export type SubagentState = {
	mistralApiKey: string;
};

export type SubagentHelpers = {
	readJsonBody: (request: IncomingMessage) => Promise<Record<string, unknown>>;
	readState: () => Promise<SubagentState>;
	sendJson: (response: ServerResponse, statusCode: number, body: unknown) => void;
	setNoStore: (response: ServerResponse) => void;
};

export type SubagentModelResolution = { provider: "mistral" | "openai-codex"; modelId: string };

export type ResolvedSubagentModel = Model<any> & { provider: string };
