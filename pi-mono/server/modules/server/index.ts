import { createServer } from "node:http";

import { ROOT_DIR, sendJson, setCorsHeaders } from "../common";
import { routeRequest } from "../http-router";
import type { ServerBootstrapOptions } from "./types";

const DEFAULT_PORT = Number(process.env.PORT || 8787);
const DEFAULT_HOST = process.env.HOST || "127.0.0.1";

export function createBackendServer(options: ServerBootstrapOptions) {
	return createServer(async (request, response) => {
		setCorsHeaders(response);

		if (!request.url || !request.headers.host) {
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
			await routeRequest({ request, response, url, rootDir: options.rootDir });
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
	const rootDir = options.rootDir ?? ROOT_DIR;

	createBackendServer({ host, port, rootDir }).listen(port, host, () => {
		console.log(`API server listening on http://${host}:${port}`);
	});
}
