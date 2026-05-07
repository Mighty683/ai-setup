import type { Context, Model, SimpleStreamOptions } from "@mariozechner/pi-ai";

type Usage = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
};

export type ProxyEvent =
	| { type: "start" }
	| { type: "text_start"; contentIndex: number }
	| { type: "text_delta"; contentIndex: number; delta: string }
	| { type: "text_end"; contentIndex: number; contentSignature?: string }
	| { type: "thinking_start"; contentIndex: number }
	| { type: "thinking_delta"; contentIndex: number; delta: string }
	| { type: "thinking_end"; contentIndex: number; contentSignature?: string }
	| { type: "toolcall_start"; contentIndex: number; id: string; toolName: string }
	| { type: "toolcall_delta"; contentIndex: number; delta: string }
	| { type: "toolcall_end"; contentIndex: number }
	| { type: "done"; reason: "stop" | "length" | "toolUse"; usage: Usage }
	| { type: "error"; reason: "aborted" | "error"; errorMessage: string; usage: Usage };

export type StreamRequestBody = {
	model: Model<any>;
	context: Context;
	agentId?: string;
	options?: Pick<SimpleStreamOptions, "maxTokens" | "reasoning" | "sessionId" | "temperature" | "transport">;
};
