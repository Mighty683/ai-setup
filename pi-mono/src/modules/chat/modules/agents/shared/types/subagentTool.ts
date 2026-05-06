export type SubagentFlowEntry = {
	role: string;
	content: string;
	timestamp?: string;
};

export type SubagentRunDetails = {
	toolCallId: string;
	agentId: string;
	task: string;
	summary: string;
	status: "completed" | "failed";
	errorMessage?: string;
	flow: SubagentFlowEntry[];
};
