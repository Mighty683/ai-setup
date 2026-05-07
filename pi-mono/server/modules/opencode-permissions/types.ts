export const ALLOWED_PERMISSION_KEYS = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;

export type ToolPermissionKey = (typeof ALLOWED_PERMISSION_KEYS)[number];

export type TaskPermissionDefinition = {
	explore?: "allow" | "deny";
	private?: "allow" | "deny";
	corporal?: "allow" | "deny";
};

export type PermissionDefinition = Partial<Record<ToolPermissionKey, "allow" | "deny">> & {
	task?: TaskPermissionDefinition;
};

export type OpencodeAgentDefinition = {
	model?: string;
	mode?: string;
	role?: string;
	prompt?: string;
	permission?: PermissionDefinition | Record<string, unknown>;
};

export type OpencodeConfig = {
	agent?: Record<string, OpencodeAgentDefinition>;
};

export type OpencodeAgentProfile = {
	id: string;
	model: string;
	mode: "primary" | "subagent";
	role: string;
	prompt: string;
	permission?: PermissionDefinition | Record<string, unknown>;
};
