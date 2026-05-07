import type { IncomingMessage, ServerResponse } from "node:http";

import { streamSimple } from "@mariozechner/pi-ai";
import type { AssistantMessageEvent } from "@mariozechner/pi-ai";

import { emptyUsage, logBackendEvent, readBearerToken, readJsonBody, readRequestId, sendJson } from "../common";
import { deriveAllowedToolsForAgent } from "../opencode-permissions";
import { updateState } from "../state";
import type { ProxyEvent, StreamRequestBody } from "./types";

export async function handleStreamRequest(request: IncomingMessage, response: ServerResponse, rootDir = process.cwd()): Promise<void> {
	const bearer = readBearerToken(request.headers.authorization);
	if (!bearer) {
		sendJson(response, 401, { error: "Missing Authorization bearer token." });
		return;
	}

	const body = validateStreamBody(await readJsonBody(request));
	const nextState = await updateState((current) => ({
		...current,
		selection: {
			modelId: typeof body.model.id === "string" ? body.model.id : current.selection.modelId,
			agentId: typeof body.agentId === "string" && body.agentId.trim().length > 0 ? body.agentId : current.selection.agentId,
			thinkingMode:
				typeof body.options?.reasoning === "string" ? body.options.reasoning : typeof body.options?.reasoning === "number" ? String(body.options.reasoning) : current.selection.thinkingMode,
		},
	}));
	const selectedAgentId = nextState.selection.agentId;
	const requestId = readRequestId(request.headers);
	const startedAt = Date.now();
	let didThrow = false;
	const abortController = new AbortController();
	request.on("close", () => abortController.abort());

	response.writeHead(200, {
		"Cache-Control": "no-cache, no-transform",
		Connection: "keep-alive",
		"Content-Type": "text/event-stream; charset=utf-8",
	});
	response.write(": connected\n\n");

	try {
		const allowedTools = await deriveAllowedToolsForAgent(rootDir, selectedAgentId);
		const allowedToolNames = allowedTools
			.map((tool) => {
				if (!tool || typeof tool !== "object") {
					return undefined;
				}
				const maybeName = (tool as { name?: unknown }).name;
				return typeof maybeName === "string" && maybeName.trim().length > 0 ? maybeName : undefined;
			})
			.filter((name): name is string => Boolean(name));
		logBackendEvent({
			event: "agent_operation",
			operation: "stream",
			phase: "start",
			requestId,
			agentId: selectedAgentId,
			modelId: body.model.id,
			reasoning: body.options?.reasoning,
			sessionId: body.options?.sessionId,
			allowedToolsCount: allowedTools.length,
			allowedToolNames,
		});
		logBackendEvent({
			event: "model_request",
			operation: "stream",
			phase: "start",
			requestId,
			agentId: selectedAgentId,
			modelId: body.model.id,
			hasTools: allowedTools.length > 0,
			toolCount: allowedTools.length,
			hasSessionId: Boolean(body.options?.sessionId),
			hasReasoning: typeof body.options?.reasoning !== "undefined",
			hasMaxTokens: typeof body.options?.maxTokens !== "undefined",
			hasTemperature: typeof body.options?.temperature !== "undefined",
			hasTransport: typeof body.options?.transport !== "undefined",
		});
		const stream = streamSimple(body.model, body.context, {
			apiKey: bearer,
			maxTokens: body.options?.maxTokens,
			reasoning: body.options?.reasoning,
			sessionId: body.options?.sessionId,
			signal: abortController.signal,
			temperature: body.options?.temperature,
			transport: body.options?.transport,
			...(allowedTools.length > 0 ? ({ tools: allowedTools } as unknown as Record<string, unknown>) : {}),
		});

		const eventCounts: Record<string, number> = {};
		let toolCallCount = 0;

		for await (const event of stream) {
			eventCounts[event.type] = (eventCounts[event.type] || 0) + 1;
			if (event.type === "toolcall_start") {
				toolCallCount += 1;
				const block = event.partial.content[event.contentIndex];
				logBackendEvent({
					event: "tool_call",
					operation: "stream",
					phase: "start",
					requestId,
					agentId: selectedAgentId,
					modelId: body.model.id,
					contentIndex: event.contentIndex,
					toolCallId: block?.type === "toolCall" ? block.id : undefined,
					toolName: block?.type === "toolCall" ? block.name : undefined,
				});
			}
			if (event.type === "error") {
				logBackendEvent({
					event: "model_stream_event",
					operation: "stream",
					phase: "error",
					requestId,
					agentId: selectedAgentId,
					modelId: body.model.id,
					reason: event.reason,
					errorMessage: event.error.errorMessage,
				});
			}
			response.write(`data: ${JSON.stringify(toProxyEvent(event))}\n\n`);
		}

		logBackendEvent({
			event: "model_stream_summary",
			operation: "stream",
			phase: "end",
			requestId,
			agentId: selectedAgentId,
			modelId: body.model.id,
			toolCallCount,
			eventCounts,
		});
	} catch (error) {
		didThrow = true;
		const message = error instanceof Error ? error.message : "Proxy request failed.";
		logBackendEvent({
			event: "agent_operation",
			operation: "stream",
			phase: "end",
			status: "failed",
			errorMessage: message,
			aborted: abortController.signal.aborted,
			durationMs: Date.now() - startedAt,
			requestId,
			agentId: selectedAgentId,
			modelId: body.model.id,
		});
		response.write(
			`data: ${JSON.stringify({ type: "error", reason: abortController.signal.aborted ? "aborted" : "error", errorMessage: message, usage: emptyUsage() } satisfies ProxyEvent)}\n\n`,
		);
	} finally {
		if (!didThrow) {
			logBackendEvent({
				event: "agent_operation",
				operation: "stream",
				phase: "end",
				status: abortController.signal.aborted ? "aborted" : "completed",
				durationMs: Date.now() - startedAt,
				requestId,
				agentId: selectedAgentId,
				modelId: body.model.id,
			});
		}
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
