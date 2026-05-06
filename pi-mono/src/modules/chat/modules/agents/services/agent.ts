import { Agent, type AgentState, type AgentTool } from "@mariozechner/pi-agent-core";
import { customConvertToLlm } from "~src/modules/chat/modules/chat/shared/utils/custom-messages";
import { extractPlainText } from "~src/modules/chat/modules/chat/shared/utils/custom-messages";
import { resolveModel } from "~src/modules/chat/modules/modelsProviders/services/models";
import type { OpenAICodexCredentials } from "~src/modules/chat/modules/agents/services/openaiCodexOAuth";
import { refreshOpenAICodexCredentials } from "~src/modules/chat/modules/agents/services/openaiCodexOAuth";
import { streamBackendProxy } from "~src/modules/chat/modules/agents/services/backendProxy";
import { DEFAULT_SYSTEM_PROMPT } from "~src/modules/chat/modules/agents/shared/constants/systemPrompt";
import { findOpencodeAgent } from "~src/modules/chat/modules/opencodeConfig/services/opencode";
import type { SubagentRunDetails } from "~src/modules/chat/modules/agents/shared/types/subagentTool";

type AgentFactoryOptions = {
	initialState?: Partial<AgentState>;
	selectedModelId: string;
	mistralApiKey: string;
	openAICodexCredentials?: OpenAICodexCredentials;
	onOpenAICodexCredentialsChange?: (credentials?: OpenAICodexCredentials) => void;
	enableSubagentTool?: boolean;
};

export function createAgentInstance(options: AgentFactoryOptions): Agent {
	const { initialState, selectedModelId, mistralApiKey } = options;
	let openAICodexCredentials = options.openAICodexCredentials;
	const enableSubagentTool = options.enableSubagentTool ?? true;

	const subagentTool: AgentTool<any, SubagentRunDetails> = {
		name: "run_subagent",
		label: "Run subagent",
		description: "Delegate a task to a configured subagent profile.",
		parameters: {
			type: "object",
			properties: {
				agentId: { type: "string", minLength: 1 },
				task: { type: "string", minLength: 1 },
			},
			required: ["agentId", "task"],
			additionalProperties: false,
		} as any,
		execute: async (toolCallId: string, params: { agentId: string; task: string }) => {
			const profile = findOpencodeAgent(params.agentId);

			if (!profile || profile.mode !== "subagent") {
				throw new Error(`Unknown subagent profile: ${params.agentId}`);
			}

			const delegatedAgent = createAgentInstance({
				selectedModelId: profile.model,
				mistralApiKey,
				openAICodexCredentials,
				onOpenAICodexCredentialsChange: (credentials) => {
					openAICodexCredentials = credentials;
					options.onOpenAICodexCredentialsChange?.(credentials);
				},
				enableSubagentTool: false,
				initialState: {
					systemPrompt: profile.prompt,
					thinkingLevel: initialState?.thinkingLevel || "off",
					messages: [],
					tools: [],
					model: resolveModel(profile.model),
				},
			});

			await delegatedAgent.prompt(params.task);

			const flow = delegatedAgent.state.messages.map((message) => ({
				role: message.role,
				content:
					"content" in message
						? extractPlainText(message.content)
						: "message" in message
							? String(message.message)
							: "",
				timestamp: message.timestamp ? new Date(message.timestamp).toISOString() : undefined,
			}));

			const assistantReply = [...delegatedAgent.state.messages]
				.reverse()
				.find((message) => message.role === "assistant");
			const summaryFromAssistant = assistantReply ? extractPlainText(assistantReply.content) : "";
			const fallbackSummary = [...flow]
				.reverse()
				.find((entry) => entry.content.trim().length > 0)?.content;
			const assistantError = assistantReply && "errorMessage" in assistantReply ? assistantReply.errorMessage : undefined;
			const errorMessage = delegatedAgent.state.errorMessage || assistantError;
			const summary = summaryFromAssistant || fallbackSummary || "";
			const isFailed = Boolean(errorMessage);

			const details: SubagentRunDetails = {
				toolCallId,
				agentId: profile.id,
				task: params.task,
				summary: summary || (isFailed ? "(subagent failed without textual output)" : "(empty response)"),
				status: isFailed ? "failed" : "completed",
				errorMessage: errorMessage || undefined,
				flow,
			};

			if (isFailed) {
				throw new Error(errorMessage || "Subagent failed");
			}

			return {
				content: [{ type: "text", text: details.summary } as const],
				details,
			};
		},
	};

	return new Agent({
		initialState: {
			systemPrompt: initialState?.systemPrompt || DEFAULT_SYSTEM_PROMPT,
			thinkingLevel: initialState?.thinkingLevel || "off",
			messages: initialState?.messages || [],
			tools: enableSubagentTool ? [subagentTool] : [],
			model: initialState?.model || resolveModel(selectedModelId),
		},
		convertToLlm: customConvertToLlm,
		streamFn: streamBackendProxy,
		toolExecution: "parallel",
		getApiKey: async (provider) => {
			if (provider === "mistral") {
				return mistralApiKey;
			}

			if (provider !== "openai-codex") {
				return "";
			}

			if (!openAICodexCredentials) {
				return "";
			}

			const now = Date.now();
			if (openAICodexCredentials.expires <= now + 30_000) {
				openAICodexCredentials = await refreshOpenAICodexCredentials(openAICodexCredentials);
				options.onOpenAICodexCredentialsChange?.(openAICodexCredentials);
			}

			return openAICodexCredentials.access;
		},
	});
}
