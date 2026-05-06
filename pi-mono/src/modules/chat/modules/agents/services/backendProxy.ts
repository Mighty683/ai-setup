import { streamProxy } from "@mariozechner/pi-agent-core";
import type { Context, Model, SimpleStreamOptions } from "@mariozechner/pi-ai";

export function streamBackendProxy(model: Model<any>, context: Context, options?: SimpleStreamOptions) {
	const apiKey = options?.apiKey;
	if (!apiKey) {
		throw new Error(`No API key for provider: ${model.provider}`);
	}

	return streamProxy(model, context, {
		authToken: apiKey,
		maxTokens: options?.maxTokens,
		proxyUrl: window.location.origin,
		reasoning: options?.reasoning,
		signal: options?.signal,
		temperature: options?.temperature,
	});
}
