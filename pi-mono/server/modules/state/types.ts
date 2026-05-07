export type OpenAICodexCredentials = {
	access: string;
	refresh: string;
	expires: number;
	accountId: string;
};

export type PersistedState = {
	mistralApiKey: string;
	openAICodexCredentials?: OpenAICodexCredentials;
	sessions: unknown[];
};
