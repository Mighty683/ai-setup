import { Agent, type AgentState } from "@mariozechner/pi-agent-core";
import { customConvertToLlm } from "~src/modules/chat/modules/chat/shared/utils/custom-messages";
import { resolveModel } from "~src/modules/chat/modules/modelsProviders/services/models";
import type { OpenAICodexCredentials } from "~src/modules/chat/modules/agents/services/openaiCodexOAuth";
import { refreshOpenAICodexCredentials } from "~src/modules/chat/modules/agents/services/openaiCodexOAuth";
import { DEFAULT_SYSTEM_PROMPT } from "~src/modules/chat/modules/agents/shared/constants/systemPrompt";

type AgentFactoryOptions = {
	initialState?: Partial<AgentState>;
	selectedModelId: string;
	mistralApiKey: string;
	openAICodexCredentials?: OpenAICodexCredentials;
	onOpenAICodexCredentialsChange?: (credentials?: OpenAICodexCredentials) => void;
};

export function createAgentInstance(options: AgentFactoryOptions): Agent {
	const { initialState, selectedModelId, mistralApiKey } = options;
	let openAICodexCredentials = options.openAICodexCredentials;

	return new Agent({
		initialState: {
			systemPrompt: initialState?.systemPrompt || DEFAULT_SYSTEM_PROMPT,
			thinkingLevel: initialState?.thinkingLevel || "off",
			messages: initialState?.messages || [],
			tools: [],
			model: initialState?.model || resolveModel(selectedModelId),
		},
		convertToLlm: customConvertToLlm,
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
