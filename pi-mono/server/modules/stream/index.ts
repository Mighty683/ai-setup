import type { IncomingMessage, ServerResponse } from "node:http";

import { streamSimple } from "@mariozechner/pi-ai";
import type { AssistantMessageEvent } from "@mariozechner/pi-ai";

import { emptyUsage, readBearerToken, readJsonBody, sendJson } from "../common";
import type { ProxyEvent, StreamRequestBody } from "./types";

export async function handleStreamRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
	const bearer = readBearerToken(request.headers.authorization);
	if (!bearer) {
		sendJson(response, 401, { error: "Missing Authorization bearer token." });
		return;
	}

	const body = validateStreamBody(await readJsonBody(request));
	const abortController = new AbortController();
	request.on("close", () => abortController.abort());

	response.writeHead(200, {
		"Cache-Control": "no-cache, no-transform",
		Connection: "keep-alive",
		"Content-Type": "text/event-stream; charset=utf-8",
	});
	response.write(": connected\n\n");

	try {
		const stream = streamSimple(body.model, body.context, {
			apiKey: bearer,
			maxTokens: body.options?.maxTokens,
			reasoning: body.options?.reasoning,
			sessionId: body.options?.sessionId,
			signal: abortController.signal,
			temperature: body.options?.temperature,
			transport: body.options?.transport,
		});

		for await (const event of stream) {
			response.write(`data: ${JSON.stringify(toProxyEvent(event))}\n\n`);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : "Proxy request failed.";
		response.write(
			`data: ${JSON.stringify({ type: "error", reason: abortController.signal.aborted ? "aborted" : "error", errorMessage: message, usage: emptyUsage() } satisfies ProxyEvent)}\n\n`,
		);
	} finally {
		response.end();
	}
}

export function toProxyEvent(event: AssistantMessageEvent): ProxyEvent {
	switch (event.type) {
		case "start":
			return { type: "start" };
		case "text_start":
			return { type: "text_start", contentIndex: event.contentIndex };
		case "text_delta":
			return { type: "text_delta", contentIndex: event.contentIndex, delta: event.delta };
		case "text_end": {
			const block = event.partial.content[event.contentIndex];
			return {
				type: "text_end",
				contentIndex: event.contentIndex,
				contentSignature: block?.type === "text" ? block.textSignature : undefined,
			};
		}
		case "thinking_start":
			return { type: "thinking_start", contentIndex: event.contentIndex };
		case "thinking_delta":
			return { type: "thinking_delta", contentIndex: event.contentIndex, delta: event.delta };
		case "thinking_end": {
			const block = event.partial.content[event.contentIndex];
			return {
				type: "thinking_end",
				contentIndex: event.contentIndex,
				contentSignature: block?.type === "thinking" ? block.thinkingSignature : undefined,
			};
		}
		case "toolcall_start": {
			const block = event.partial.content[event.contentIndex];
			return {
				type: "toolcall_start",
				contentIndex: event.contentIndex,
				id: block?.type === "toolCall" ? block.id : "",
				toolName: block?.type === "toolCall" ? block.name : "",
			};
		}
		case "toolcall_delta":
			return { type: "toolcall_delta", contentIndex: event.contentIndex, delta: event.delta };
		case "toolcall_end":
			return { type: "toolcall_end", contentIndex: event.contentIndex };
		case "done":
			return { type: "done", reason: event.reason, usage: event.message.usage };
		case "error":
			return {
				type: "error",
				reason: event.reason,
				errorMessage: event.error.errorMessage || "Proxy request failed.",
				usage: event.error.usage,
			};
	}
}

export function validateStreamBody(body: Record<string, unknown>): StreamRequestBody {
	if (!body.model || typeof body.model !== "object") {
		throw new Error("Stream payload is missing model.");
	}

	if (!body.context || typeof body.context !== "object") {
		throw new Error("Stream payload is missing context.");
	}

	return body as unknown as StreamRequestBody;
}
