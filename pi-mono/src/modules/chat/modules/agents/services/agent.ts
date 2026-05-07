import { Agent, type AgentState, type AgentTool } from "@mariozechner/pi-agent-core";
import { customConvertToLlm } from "~src/modules/chat/modules/chat/shared/utils/custom-messages";
import { extractPlainText } from "~src/modules/chat/modules/chat/shared/utils/custom-messages";
import { resolveModel } from "~src/modules/chat/modules/modelsProviders/services/models";
import type { OpenAICodexCredentials } from "~src/modules/chat/modules/agents/services/openaiCodexOAuth";
import { refreshOpenAICodexCredentials } from "~src/modules/chat/modules/agents/services/openaiCodexOAuth";
import { streamBackendProxy } from "~src/modules/chat/modules/agents/services/backendProxy";
import { DEFAULT_SYSTEM_PROMPT } from "~src/modules/chat/modules/agents/shared/constants/systemPrompt";
import { findOpencodeAgent, getOpencodeAgents } from "~src/modules/chat/modules/opencodeConfig/services/opencode";
import type { SubagentRunDetails } from "~src/modules/chat/modules/agents/shared/types/subagentTool";

type SubagentRunRequest = {
	agentId: string;
	task: string;
	mistralApiKey: string;
	openAIAccessToken?: string;
};

type SubagentRunResponse = {
	summary?: unknown;
	status?: unknown;
	errorMessage?: unknown;
	flow?: unknown;
};

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
		description: "Delegate a task to a configured subagent profile. Available subagent profiles: " +
			getOpencodeAgents()
				.filter((a) => a.mode === "subagent")
				.map((a) => a.id)
				.join(", "),
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
			let profile = findOpencodeAgent(params.agentId);

			if (!profile || profile.mode !== "subagent") {
				const subagents = getOpencodeAgents().filter((a) => a.mode === "subagent");
				if (subagents.length > 0 && (params.agentId === "default" || params.agentId === "private")) {
					profile = subagents[0];
				} else {
					throw new Error(`Unknown subagent profile: ${params.agentId}`);
				}
			}

			const openAIAccessToken = await getOpenAICodexAccessToken(openAICodexCredentials, (credentials) => {
				openAICodexCredentials = credentials;
				options.onOpenAICodexCredentialsChange?.(credentials);
			});

			const response = await fetch("/api/subagent/run", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					agentId: profile.id,
					task: params.task,
					mistralApiKey,
					openAIAccessToken,
				} satisfies SubagentRunRequest),
			});

			if (!response.ok) {
				const text = await response.text().catch(() => "");
				throw new Error(`Subagent run request failed (${response.status}): ${text || response.statusText}`);
			}

			const parsed = ((await response.json()) as SubagentRunResponse) || {};
			const flow = Array.isArray(parsed.flow)
				? parsed.flow.reduce<SubagentRunDetails["flow"]>((acc, entry) => {
						if (!entry || typeof entry !== "object") {
							return acc;
						}

						const item = entry as Partial<{ role: unknown; content: unknown; timestamp: unknown }>;
						acc.push({
							role: typeof item.role === "string" ? item.role : "",
							content: typeof item.content === "string" ? item.content : "",
							timestamp: typeof item.timestamp === "string" ? item.timestamp : undefined,
						});
						return acc;
				  }, [])
				: [];
			const summary = typeof parsed.summary === "string" ? parsed.summary : "";
			const errorMessage = typeof parsed.errorMessage === "string" ? parsed.errorMessage : undefined;
			const status = parsed.status === "failed" ? "failed" : "completed";
			const isFailed = status === "failed";

			const details: SubagentRunDetails = {
				toolCallId,
				agentId: profile.id,
				task: params.task,
				summary: summary || (isFailed ? "(subagent failed without textual output)" : "(empty response)"),
				status,
				errorMessage: errorMessage || undefined,
				flow,
			};

			if (isFailed) {
				const error = new Error(errorMessage || details.summary || "Subagent failed") as Error & {
					content?: Array<{ type: "text"; text: string }>;
					details?: SubagentRunDetails;
				};
				error.content = [{ type: "text", text: details.summary }];
				error.details = details;
				throw error;
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

async function getOpenAICodexAccessToken(
	credentials: OpenAICodexCredentials | undefined,
	onCredentialsChange: (credentials?: OpenAICodexCredentials) => void,
): Promise<string | undefined> {
	if (!credentials) {
		return undefined;
	}

	let next = credentials;
	const now = Date.now();
	if (next.expires <= now + 30_000) {
		next = await refreshOpenAICodexCredentials(next);
		onCredentialsChange(next);
	}

	return next.access;
}
