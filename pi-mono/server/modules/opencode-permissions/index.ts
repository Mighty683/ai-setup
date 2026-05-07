import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { getModels } from "@mariozechner/pi-ai";

import { DEFAULT_AGENT_ID } from "../state";
import { ALLOWED_PERMISSION_KEYS } from "./types";
import type {
	OpencodeAgentDefinition,
	OpencodeAgentProfile,
	OpencodeConfig,
	PermissionDefinition,
	ToolPermissionKey,
} from "./types";

const BUILTIN_DEFAULT_AGENT_MODEL = "openai/gpt-5.3-codex";
const BUILTIN_DEFAULT_AGENT_PROMPT =
	"You are a minimal coding agent. Solve the requested coding task with clear reasoning, minimal changes, and concise explanations.";

export async function readOpencodeConfig(rootDir: string): Promise<OpencodeConfig> {
	const opencodeConfigFile = resolve(rootDir, "../opencode.json");
	return JSON.parse(await readFile(opencodeConfigFile, "utf8")) as OpencodeConfig;
}

export function getBuiltinDefaultAgentProfile(): OpencodeAgentProfile {
	return {
		id: DEFAULT_AGENT_ID,
		model: BUILTIN_DEFAULT_AGENT_MODEL,
		mode: "primary",
		role: "primary",
		prompt: BUILTIN_DEFAULT_AGENT_PROMPT,
		permission: undefined,
	};
}

export function parseAgentProfiles(config: OpencodeConfig): OpencodeAgentProfile[] {
	const entries = Object.entries(config.agent || {});

	return entries
		.map(([id, definition]) => parseAgentProfile(id, definition))
		.filter((agent): agent is OpencodeAgentProfile => Boolean(agent));
}

export async function getAgentProfiles(rootDir: string): Promise<OpencodeAgentProfile[]> {
	const parsed = parseAgentProfiles(await readOpencodeConfig(rootDir));
	return [getBuiltinDefaultAgentProfile(), ...parsed.filter((agent) => agent.id !== DEFAULT_AGENT_ID)];
}

export async function findAgentProfile(agentId: string, rootDir: string): Promise<OpencodeAgentProfile | undefined> {
	const profiles = await getAgentProfiles(rootDir);
	return profiles.find((profile) => profile.id === agentId);
}

export async function getPrimaryAgentProfiles(rootDir: string): Promise<OpencodeAgentProfile[]> {
	const profiles = await getAgentProfiles(rootDir);
	return profiles.filter((profile) => profile.mode === "primary");
}

export async function getPrimaryAgentCatalog(rootDir: string): Promise<{ agents: OpencodeAgentProfile[]; models: string[] }> {
	const agents = await getPrimaryAgentProfiles(rootDir);
	const models = [...new Set(agents.map((agent) => agent.model).filter((model) => model.trim().length > 0))];
	return { agents, models };
}

export function deriveAllowedToolsFromPermission(permission: unknown): ToolPermissionKey[] {
	if (!permission || typeof permission !== "object") {
		return [];
	}

	const typedPermission = permission as Record<string, unknown>;
	const tools: ToolPermissionKey[] = [];

	for (const key of ALLOWED_PERMISSION_KEYS) {
		if (typedPermission[key] === "allow") {
			tools.push(key);
		}
	}

	return tools;
}

export function canSpawnSubagents(permission: unknown): boolean {
	if (!permission || typeof permission !== "object") {
		return false;
	}

	const taskPermission = (permission as { task?: unknown }).task;
	if (!taskPermission || typeof taskPermission !== "object") {
		return false;
	}

	return Object.values(taskPermission as Record<string, unknown>).some((value) => value === "allow");
}

export async function deriveAllowedToolsForAgent(rootDir: string, agentId: string): Promise<ToolPermissionKey[]> {
	const profile = await findAgentProfile(agentId, rootDir);
	return deriveAllowedToolsFromPermission(profile?.permission);
}

export function normalizeModelSelection(inputModelId: string): { provider: "mistral" | "openai-codex"; modelId: string } {
	if (inputModelId.startsWith("mistral/")) {
		return { provider: "mistral", modelId: inputModelId.slice("mistral/".length) };
	}

	if (inputModelId.startsWith("openai/") || inputModelId.startsWith("openai-codex/")) {
		return { provider: "openai-codex", modelId: inputModelId.split("/").slice(1).join("/") };
	}

	const mistralMatch = getModels("mistral").find((model) => model.id === inputModelId);
	if (mistralMatch) {
		return { provider: "mistral", modelId: inputModelId };
	}

	return { provider: "openai-codex", modelId: inputModelId };
}

function parseAgentProfile(id: string, definition: OpencodeAgentDefinition | undefined): OpencodeAgentProfile | undefined {
	if (!definition || typeof definition !== "object") {
		return undefined;
	}

	const model = typeof definition.model === "string" ? definition.model : "";
	if (!model) {
		return undefined;
	}

	return {
		id,
		model,
		mode: definition.mode === "subagent" ? "subagent" : "primary",
		role: typeof definition.role === "string" ? definition.role : "",
		prompt: typeof definition.prompt === "string" ? definition.prompt : "",
		permission: definition.permission as PermissionDefinition | Record<string, unknown> | undefined,
	};
}

export { ALLOWED_PERMISSION_KEYS };
export type { OpencodeAgentDefinition, OpencodeAgentProfile, OpencodeConfig, PermissionDefinition, ToolPermissionKey };
