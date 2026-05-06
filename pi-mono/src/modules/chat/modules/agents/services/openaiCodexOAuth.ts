const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const REDIRECT_URI = "http://localhost:1455/auth/callback";
const SCOPE = "openid profile email offline_access";
const EXCHANGE_ENDPOINT = "/api/openai-codex/oauth/exchange";
const REFRESH_ENDPOINT = "/api/openai-codex/oauth/refresh";

export type OpenAICodexCredentials = {
	access: string;
	refresh: string;
	expires: number;
	accountId: string;
};

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}

	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomHex(bytes = 16): string {
	const buffer = new Uint8Array(bytes);
	crypto.getRandomValues(buffer);
	return Array.from(buffer)
		.map((value) => value.toString(16).padStart(2, "0"))
		.join("");
}

function createCodeVerifier(length = 64): string {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
	const randomValues = new Uint8Array(length);
	crypto.getRandomValues(randomValues);

	let verifier = "";
	for (const value of randomValues) {
		verifier += alphabet[value % alphabet.length];
	}

	return verifier;
}

async function createPkceChallenge(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	return bytesToBase64Url(new Uint8Array(digest));
}

function parseAuthorizationInput(input: string): { code?: string; state?: string } {
	const value = input.trim();
	if (!value) {
		return {};
	}

	try {
		const url = new URL(value);
		return {
			code: url.searchParams.get("code") ?? undefined,
			state: url.searchParams.get("state") ?? undefined,
		};
	} catch {
		// noop
	}

	if (value.includes("#")) {
		const [code, state] = value.split("#", 2);
		return { code, state };
	}

	if (value.includes("code=")) {
		const params = new URLSearchParams(value);
		return {
			code: params.get("code") ?? undefined,
			state: params.get("state") ?? undefined,
		};
	}

	return { code: value };
}

async function exchangeAuthorizationCode(code: string, codeVerifier: string): Promise<OpenAICodexCredentials> {
	return postOAuthCredentials(EXCHANGE_ENDPOINT, { code, codeVerifier });
}

export async function refreshOpenAICodexCredentials(credentials: OpenAICodexCredentials): Promise<OpenAICodexCredentials> {
	return postOAuthCredentials(REFRESH_ENDPOINT, { refresh: credentials.refresh });
}

async function postOAuthCredentials(url: string, payload: Record<string, string>): Promise<OpenAICodexCredentials> {
	const response = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(payload),
	});

	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(`OpenAI OAuth request failed (${response.status}): ${text || response.statusText}`);
	}

	const json = (await response.json()) as Partial<OpenAICodexCredentials>;
	if (
		typeof json.access !== "string" ||
		typeof json.refresh !== "string" ||
		typeof json.accountId !== "string" ||
		typeof json.expires !== "number"
	) {
		throw new Error("OpenAI OAuth response was missing required fields.");
	}

	return {
		access: json.access,
		refresh: json.refresh,
		expires: json.expires,
		accountId: json.accountId,
	};
}

export async function loginOpenAICodexByBrowser(): Promise<OpenAICodexCredentials> {
	const verifier = createCodeVerifier();
	const challenge = await createPkceChallenge(verifier);
	const state = randomHex();

	const authUrl = new URL(AUTHORIZE_URL);
	authUrl.searchParams.set("response_type", "code");
	authUrl.searchParams.set("client_id", CLIENT_ID);
	authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
	authUrl.searchParams.set("scope", SCOPE);
	authUrl.searchParams.set("code_challenge", challenge);
	authUrl.searchParams.set("code_challenge_method", "S256");
	authUrl.searchParams.set("state", state);
	authUrl.searchParams.set("id_token_add_organizations", "true");
	authUrl.searchParams.set("codex_cli_simplified_flow", "true");
	authUrl.searchParams.set("originator", "pi");

	window.open(authUrl.toString(), "_blank", "noopener,noreferrer");

	const input = window.prompt(
		"Complete login in the opened tab, then paste the full redirect URL (or auth code) from the browser address bar:",
	);

	if (!input) {
		throw new Error("OpenAI login was cancelled.");
	}

	const parsed = parseAuthorizationInput(input);
	if (!parsed.code) {
		throw new Error("No authorization code found in pasted value.");
	}

	if (parsed.state && parsed.state !== state) {
		throw new Error("OpenAI OAuth state mismatch.");
	}

	return exchangeAuthorizationCode(parsed.code, verifier);
}
