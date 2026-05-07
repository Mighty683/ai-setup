import { readJsonBody, sendJson, setNoStore } from "../common";
import { handleOAuthExchange, handleOAuthRefresh } from "../oauth";
import { handleCredentialsUpdate, handleSessionsUpdate, handleSettingsUpdate, readState } from "../state";
import { serveStaticAsset } from "../static";
import { handleStreamRequest } from "../stream";
import { handleSubagentRunRequest } from "../subagent";
import type { RouteContext } from "./types";

export async function routeRequest({ request, response, url, rootDir }: RouteContext): Promise<void> {
	if (request.method === "GET" && url.pathname === "/api/health") {
		sendJson(response, 200, { ok: true });
		return;
	}

	if (request.method === "GET" && url.pathname === "/api/state") {
		setNoStore(response);
		sendJson(response, 200, await readState());
		return;
	}

	if (request.method === "PUT" && url.pathname === "/api/state/settings") {
		await handleSettingsUpdate(request, response);
		return;
	}

	if (request.method === "PUT" && url.pathname === "/api/state/openai-codex-credentials") {
		await handleCredentialsUpdate(request, response);
		return;
	}

	if (request.method === "PUT" && url.pathname === "/api/state/sessions") {
		await handleSessionsUpdate(request, response);
		return;
	}

	if (request.method === "POST" && url.pathname === "/api/stream") {
		await handleStreamRequest(request, response);
		return;
	}

	if (request.method === "POST" && url.pathname === "/api/subagent/run") {
		await handleSubagentRunRequest(request, response, rootDir, { readJsonBody, readState, sendJson, setNoStore });
		return;
	}

	if (request.method === "POST" && (url.pathname === "/api/ask-subagent" || url.pathname === "/ask-subagent")) {
		await handleSubagentRunRequest(request, response, rootDir, { readJsonBody, readState, sendJson, setNoStore });
		return;
	}

	if (request.method === "POST" && url.pathname === "/api/openai-codex/oauth/exchange") {
		await handleOAuthExchange(request, response);
		return;
	}

	if (request.method === "POST" && url.pathname === "/api/openai-codex/oauth/refresh") {
		await handleOAuthRefresh(request, response);
		return;
	}

	if (request.method === "GET" || request.method === "HEAD") {
		await serveStaticAsset(url.pathname, response, request.method === "HEAD", rootDir, { sendJson });
		return;
	}

	sendJson(response, 404, { error: "Not found." });
}
