import { createServer } from "node:http";

import { APP_ROOT, WORKSPACE_ROOT, logBackendEvent, readRequestId, sendJson, setCorsHeaders } from "../common";
import { routeRequest } from "../http-router";
import type { ServerBootstrapOptions } from "./types";

const DEFAULT_PORT = Number(process.env.PORT || 8787);
const DEFAULT_HOST = process.env.HOST || "127.0.0.1";

export function createBackendServer(options: ServerBootstrapOptions) {
	return createServer(async (request, response) => {
		const startTime = Date.now();
		const requestId = readRequestId(request.headers);
		const method = request.method;
		const path = request.url ? new URL(request.url, "http://localhost").pathname : undefined;

		response.on("finish", () => {
			logBackendEvent({
				event: "http_request",
				method,
				path,
				statusCode: response.statusCode,
				durationMs: Date.now() - startTime,
				...(requestId ? { requestId } : {}),
			});
		});

		setCorsHeaders(response);

		if (!request.url || !request.headers.host) {
			logBackendEvent({
				event: "http_request_rejected",
				reason: "invalid_request",
				method,
				path,
				...(requestId ? { requestId } : {}),
			});
			sendJson(response, 400, { error: "Invalid request." });
			return;
		}

		if (request.method === "OPTIONS") {
			response.writeHead(204);
			response.end();
			return;
		}

		const url = new URL(request.url, `http://${request.headers.host}`);

		try {
			await routeRequest({ request, response, url, appRoot: options.appRoot, workspaceRoot: options.workspaceRoot });
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unexpected server error.";
			if (response.headersSent) {
				response.end();
				return;
			}
			sendJson(response, 500, { error: message });
		}
	});
}

export function startServer(options: Partial<ServerBootstrapOptions> = {}): void {
	const host = options.host ?? DEFAULT_HOST;
	const port = options.port ?? DEFAULT_PORT;
	const appRoot = options.appRoot ?? APP_ROOT;
	const workspaceRoot = options.workspaceRoot ?? WORKSPACE_ROOT;

	createBackendServer({ host, port, appRoot, workspaceRoot }).listen(port, host, () => {
		console.log(`API server listening on http://${host}:${port}`);
	});
}
