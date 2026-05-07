import { handleAgentRunRequest, handleCatalogRequest } from "../ai-runtime";
import { sendJson, setNoStore } from "../common";
import { handleOAuthExchange, handleOAuthRefresh } from "../oauth";
import { handleCredentialsUpdate, handleSelectionUpdate, handleSessionsUpdate, handleSettingsUpdate, readClientState } from "../state";
import { serveStaticAsset } from "../static";
import type { RouteContext } from "./types";

export async function routeRequest({ request, response, url, appRoot, workspaceRoot }: RouteContext): Promise<void> {
	if (request.method === "GET" && url.pathname === "/api/health") {
		sendJson(response, 200, { ok: true });
		return;
	}

	if (request.method === "GET" && url.pathname === "/api/state") {
		setNoStore(response);
		sendJson(response, 200, await readClientState());
		return;
	}

	if (request.method === "GET" && url.pathname === "/api/catalog") {
		await handleCatalogRequest(response, workspaceRoot);
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

	if (request.method === "PUT" && url.pathname === "/api/state/selection") {
		await handleSelectionUpdate(request, response);
		return;
	}

	if (request.method === "POST" && url.pathname === "/api/agent/run") {
		await handleAgentRunRequest(request, response, workspaceRoot);
		return;
	}

	if (
		request.method === "POST" &&
		(url.pathname === "/api/stream" || url.pathname === "/api/subagent/run" || url.pathname === "/api/ask-subagent" || url.pathname === "/ask-subagent")
	) {
		sendJson(response, 410, { error: "Legacy AI runtime endpoint retired. Use /api/agent/run." });
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
		await serveStaticAsset(url.pathname, response, request.method === "HEAD", appRoot, { sendJson });
		return;
	}

	sendJson(response, 404, { error: "Not found." });
}
