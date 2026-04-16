import { Agent, type AgentState } from "@mariozechner/pi-agent-core";
import { getModel, getModels } from "@mariozechner/pi-ai";
import { customConvertToLlm } from "~src/core/chat/utils/custom-messages";
import { DEFAULT_PROVIDER, DEFAULT_SYSTEM_PROMPT } from "~src/modules/chat/constants/chat";

export type SupportedProvider = typeof DEFAULT_PROVIDER;
export type AvailableModel = any;

export function inferProvider(modelId: string): SupportedProvider {
	return modelId.startsWith("mistral.") ? "mistral" : DEFAULT_PROVIDER;
}

export function availableModels(provider: SupportedProvider): AvailableModel[] {
	return getModels(provider) as unknown as AvailableModel[];
}

export function resolveModel(modelId: string): AvailableModel | undefined {
	const provider = inferProvider(modelId);
	const models = availableModels(provider);
	const fromList = models.find((model) => model.id === modelId);
	if (fromList) {
		return fromList;
	}

	try {
		return getModel(provider, modelId as never);
	} catch {
		return models[0];
	}
}

type AgentFactoryOptions = {
	initialState?: Partial<AgentState>;
	selectedModelId: string;
	mistralApiKey: string;
};

export function createAgentInstance(options: AgentFactoryOptions): Agent {
	const { initialState, selectedModelId, mistralApiKey } = options;

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
			if (provider !== "mistral") {
				return "";
			}
			return mistralApiKey;
		},
	});
}
