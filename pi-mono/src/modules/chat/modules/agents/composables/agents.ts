import type { Agent, AgentState } from "@mariozechner/pi-agent-core";
import type { OpenAICodexCredentials } from "~src/modules/chat/modules/agents/services/openaiCodexOAuth";
import { createAgentInstance } from "~src/modules/chat/modules/agents/services/agent";

type CreateSubscribedAgentOptions = {
	initialState?: Partial<AgentState>;
	selectedModelId: string;
	mistralApiKey: string;
	openAICodexCredentials?: OpenAICodexCredentials;
	onOpenAICodexCredentialsChange?: (credentials?: OpenAICodexCredentials) => void;
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
		openAICodexCredentials: options.openAICodexCredentials,
		onOpenAICodexCredentialsChange: options.onOpenAICodexCredentialsChange,
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
