import type { Agent } from "@mariozechner/pi-agent-core";
import {
	inferProvider,
	resolveModel,
	type SupportedProvider,
} from "~src/modules/chat/modules/modelsProviders/services/models";

export function providerFromModelId(modelId: string): SupportedProvider {
	return inferProvider(modelId);
}

export function applySelectedModelToAgent(agent: Agent, modelId: string): string | undefined {
	const nextModel = resolveModel(modelId);
	if (!nextModel) {
		return undefined;
	}

	agent.state.model = nextModel;
	return nextModel.id;
}
