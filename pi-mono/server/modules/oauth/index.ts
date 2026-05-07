import type { IncomingMessage, ServerResponse } from "node:http";

import { readJsonBody, sendJson, setNoStore } from "../common";
import type { OpenAICodexCredentials } from "./types";

const TOKEN_URL = "https://auth.openai.com/oauth/token";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const REDIRECT_URI = "http://localhost:1455/auth/callback";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";

export async function handleOAuthExchange(request: IncomingMessage, response: ServerResponse): Promise<void> {
	const body = await readJsonBody(request);
	if (typeof body.code !== "string" || typeof body.codeVerifier !== "string") {
		sendJson(response, 400, { error: "code and codeVerifier are required." });
		return;
	}

	const credentials = await exchangeAuthorizationCode(body.code, body.codeVerifier);
	setNoStore(response);
	sendJson(response, 200, credentials);
}

export async function handleOAuthRefresh(request: IncomingMessage, response: ServerResponse): Promise<void> {
	const body = await readJsonBody(request);
	if (typeof body.refresh !== "string") {
		sendJson(response, 400, { error: "refresh is required." });
		return;
	}

	const credentials = await refreshCredentials(body.refresh);
	setNoStore(response);
	sendJson(response, 200, credentials);
}

export async function exchangeAuthorizationCode(code: string, codeVerifier: string): Promise<OpenAICodexCredentials> {
	const oauthResponse = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: CLIENT_ID,
			code,
			code_verifier: codeVerifier,
			redirect_uri: REDIRECT_URI,
		}),
	});

	return parseOAuthResponse(oauthResponse, "OpenAI token exchange failed");
}

export async function refreshCredentials(refreshToken: string): Promise<OpenAICodexCredentials> {
	const oauthResponse = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: CLIENT_ID,
		}),
	});

	return parseOAuthResponse(oauthResponse, "OpenAI token refresh failed");
}

export async function parseOAuthResponse(oauthResponse: Response, errorPrefix: string): Promise<OpenAICodexCredentials> {
	if (!oauthResponse.ok) {
		const text = await oauthResponse.text().catch(() => "");
		throw new Error(`${errorPrefix} (${oauthResponse.status}): ${text || oauthResponse.statusText}`);
	}

	const json = (await oauthResponse.json()) as {
		access_token?: string;
		refresh_token?: string;
		expires_in?: number;
	};
	if (
		typeof json.access_token !== "string" ||
		typeof json.refresh_token !== "string" ||
		typeof json.expires_in !== "number"
	) {
		throw new Error("OpenAI OAuth response was missing required fields.");
	}

	const accountId = extractAccountId(json.access_token);
	if (!accountId) {
		throw new Error("Could not extract OpenAI account ID from access token.");
	}

	return {
		access: json.access_token,
		refresh: json.refresh_token,
		expires: Date.now() + json.expires_in * 1000,
		accountId,
	};
}

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
	const parts = token.split(".");
	if (parts.length !== 3) {
		return null;
	}

	const payload = parts[1]?.replace(/-/g, "+").replace(/_/g, "/") || "";
	const pad = payload.length % 4;
	const normalizedPayload = payload + (pad ? "=".repeat(4 - pad) : "");

	try {
		return JSON.parse(Buffer.from(normalizedPayload, "base64").toString("utf8")) as Record<string, unknown>;
	} catch {
		return null;
	}
}

export function extractAccountId(accessToken: string): string | null {
	const payload = decodeJwtPayload(accessToken);
	if (!payload) {
		return null;
	}

	const authInfo = payload[JWT_CLAIM_PATH];
	if (!authInfo || typeof authInfo !== "object") {
		return null;
	}

	const accountId = (authInfo as { chatgpt_account_id?: unknown }).chatgpt_account_id;
	return typeof accountId === "string" && accountId.length > 0 ? accountId : null;
}

export { CLIENT_ID, JWT_CLAIM_PATH, REDIRECT_URI, TOKEN_URL };
