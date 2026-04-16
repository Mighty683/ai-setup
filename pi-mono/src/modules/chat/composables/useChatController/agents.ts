import type { Agent, AgentState } from "@mariozechner/pi-agent-core";
import { createAgentInstance } from "~src/modules/chat/api/agent";

type CreateSubscribedAgentOptions = {
	initialState?: Partial<AgentState>;
	selectedModelId: string;
	mistralApiKey: string;
	onStateChange: () => void;
};

type SubscribedAgent = {
	agent: Agent;
	unsubscribe: () => void;
};

export function createSubscribedAgent(options: CreateSubscribedAgentOptions): SubscribedAgent {
	const agent = createAgentInstance({
		initialState: options.initialState,
		selectedModelId: options.selectedModelId,
		mistralApiKey: options.mistralApiKey,
	});

	const unsubscribe = agent.subscribe(() => {
		options.onStateChange();
	});

	return { agent, unsubscribe };
}

export function disposeAgentSubscription(unsubscribe?: () => void): void {
	if (!unsubscribe) {
		return;
	}

	unsubscribe();
}
