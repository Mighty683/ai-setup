import { getModel, getModels } from "@mariozechner/pi-ai";
import {
	AVAILABLE_PROVIDERS,
	DEFAULT_PROVIDER,
} from "~src/modules/chat/modules/modelsProviders/shared/constants/models";

export type SupportedProvider = (typeof AVAILABLE_PROVIDERS)[number];
export type AvailableModel = any;

const MODEL_PROVIDER_BY_ID = buildModelProviderIndex();

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
	if (modelId.startsWith("mistral.")) {
		return "mistral";
	}

	return MODEL_PROVIDER_BY_ID.get(modelId) || DEFAULT_PROVIDER;
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
