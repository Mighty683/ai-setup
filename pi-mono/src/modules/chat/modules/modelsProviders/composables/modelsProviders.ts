export function providerFromModelId(modelId: string): string {
	if (modelId.startsWith("openai/") || modelId.startsWith("openai-codex/")) {
		return "openai-codex";
	}
	if (modelId.startsWith("mistral/") || modelId.startsWith("mistral.")) {
		return "mistral";
	}
	return "mistral";
}
