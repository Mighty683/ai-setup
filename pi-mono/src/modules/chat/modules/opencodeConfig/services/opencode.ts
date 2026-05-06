import opencodeConfig from "../../../../../../../opencode.json";

type RawOpencodeConfig = {
	agent?: Record<string, RawOpencodeAgent>;
};

type RawOpencodeAgent = {
	model?: string;
	mode?: string;
	role?: string;
	prompt?: string;
};

export type OpencodeAgentProfile = {
	id: string;
	model: string;
	mode: "primary" | "subagent";
	role: string;
	prompt: string;
};

const parsed = parseOpencodeConfig(opencodeConfig as RawOpencodeConfig);

function parseOpencodeConfig(config: RawOpencodeConfig): OpencodeAgentProfile[] {
	const entries = Object.entries(config.agent || {});

	return entries
		.map(([id, definition]) => {
			if (!definition || typeof definition !== "object") {
				return undefined;
			}

			const model = typeof definition.model === "string" ? definition.model : "";
			const mode = definition.mode === "subagent" ? "subagent" : "primary";
			const role = typeof definition.role === "string" ? definition.role : "";
			const prompt = typeof definition.prompt === "string" ? definition.prompt : "";

			if (!model) {
				return undefined;
			}

			return {
				id,
				model,
				mode,
				role,
				prompt,
			};
		})
		.filter((agent): agent is OpencodeAgentProfile => Boolean(agent));
}

export function getOpencodeAgents(): OpencodeAgentProfile[] {
	return parsed;
}

export function getOpencodeModels(): string[] {
	return [...new Set(parsed.map((agent) => agent.model))];
}

export function getDefaultPrimaryAgentId(): string | undefined {
	return parsed.find((agent) => agent.mode === "primary")?.id;
}

export function findOpencodeAgent(agentId: string): OpencodeAgentProfile | undefined {
	return parsed.find((agent) => agent.id === agentId);
}
