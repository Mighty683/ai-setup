import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";

export const MAX_JSON_BYTES = 25 * 1024 * 1024;
export const ROOT_DIR = fileURLToPath(new URL("../../../", import.meta.url));

export function readBearerToken(header?: string): string {
	if (!header) {
		return "";
	}

	const match = /^Bearer\s+(.+)$/i.exec(header);
	return match?.[1]?.trim() || "";
}

export function emptyUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

export async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	let totalBytes = 0;

	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		totalBytes += buffer.length;
		if (totalBytes > MAX_JSON_BYTES) {
			throw new Error(`Request body exceeded ${MAX_JSON_BYTES} bytes.`);
		}
		chunks.push(buffer);
	}

	if (chunks.length === 0) {
		return {};
	}

	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
	} catch {
		throw new Error("Request body must be valid JSON.");
	}
}

export function setCorsHeaders(response: ServerResponse): void {
	response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
	response.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,PUT,OPTIONS");
	response.setHeader("Access-Control-Allow-Origin", "*");
}

export function setNoStore(response: ServerResponse): void {
	response.setHeader("Cache-Control", "no-store");
	response.setHeader("Pragma", "no-cache");
}

export function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
	response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
	response.end(JSON.stringify(body));
}
