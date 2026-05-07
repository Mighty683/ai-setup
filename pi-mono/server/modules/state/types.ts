export type OpenAICodexCredentials = {
	access: string;
	refresh: string;
	expires: number;
	accountId: string;
};

export type OpenAICodexCredentialStatus = {
	expires: number;
	accountId: string;
};

export type UserSelectionState = {
	modelId: string;
	agentId: string;
	thinkingMode: string;
};

export type PersistedState = {
	mistralApiKey: string;
	openAICodexCredentials?: OpenAICodexCredentials;
	sessions: unknown[];
	selection: UserSelectionState;
};

export type ClientPersistedState = {
	mistralApiKey: string;
	openAICodexCredentials?: OpenAICodexCredentialStatus;
	sessions: unknown[];
	selection: UserSelectionState;
};
