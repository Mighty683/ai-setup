import { getModel, getModels } from "@mariozechner/pi-ai";
import {
	AVAILABLE_PROVIDERS,
	DEFAULT_PROVIDER,
} from "~src/modules/chat/modules/modelsProviders/shared/constants/models";

export type SupportedProvider = (typeof AVAILABLE_PROVIDERS)[number];
export type AvailableModel = any;

const MODEL_PROVIDER_BY_ID = buildModelProviderIndex();

type NormalizedModelSelection = {
	provider: SupportedProvider;
	modelId: string;
};

function normalizeModelSelection(inputModelId: string): NormalizedModelSelection {
	if (inputModelId.startsWith("mistral/")) {
		return { provider: "mistral", modelId: inputModelId.slice("mistral/".length) };
	}

	if (inputModelId.startsWith("openai/") || inputModelId.startsWith("openai-codex/")) {
		const modelId = inputModelId.includes("/") ? inputModelId.split("/").slice(1).join("/") : inputModelId;
		return { provider: "openai-codex", modelId };
	}

	return {
		provider: inferProvider(inputModelId),
		modelId: inputModelId,
	};
}

function isKnownProviderModel(model: AvailableModel | undefined): boolean {
	if (!model || typeof model !== "object") {
		return false;
	}

	const provider = (model as { provider?: unknown }).provider;
	return typeof provider === "string" && AVAILABLE_PROVIDERS.includes(provider as SupportedProvider);
}

function buildModelProviderIndex(): Map<string, SupportedProvider> {
	const modelToProvider = new Map<string, SupportedProvider>();

	for (const provider of AVAILABLE_PROVIDERS) {
		for (const model of getModels(provider) as unknown as AvailableModel[]) {
			if (typeof model?.id === "string" && !modelToProvider.has(model.id)) {
				modelToProvider.set(model.id, provider);
			}
		}
	}

	return modelToProvider;
}

export function inferProvider(modelId: string): SupportedProvider {
	if (modelId.startsWith("openai/") || modelId.startsWith("openai-codex/")) {
		return "openai-codex";
	}

	if (modelId.startsWith("mistral/")) {
		return "mistral";
	}

	if (modelId.startsWith("mistral.")) {
		return "mistral";
	}

	return MODEL_PROVIDER_BY_ID.get(modelId) || DEFAULT_PROVIDER;
}

export function availableModels(provider: SupportedProvider): AvailableModel[] {
	return getModels(provider) as unknown as AvailableModel[];
}

export function resolveModel(modelId: string): AvailableModel | undefined {
	const normalized = normalizeModelSelection(modelId);
	const provider = normalized.provider;
	const models = availableModels(provider);
	const fromList = models.find((model) => model.id === normalized.modelId || model.id === modelId);
	if (fromList) {
		return fromList;
	}

	try {
		const direct = getModel(provider, normalized.modelId as never);
		if (isKnownProviderModel(direct)) {
			return direct;
		}

		const fallback = getModel(provider, modelId as never);
		if (isKnownProviderModel(fallback)) {
			return fallback;
		}

		return models[0];
	} catch {
		return models[0];
	}
}
