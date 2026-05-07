import type { IncomingMessage, ServerResponse } from "node:http";

export type JsonBody = Record<string, unknown>;

export type ReadJsonBody = (request: IncomingMessage) => Promise<JsonBody>;

export type SendJson = (response: ServerResponse, statusCode: number, body: unknown) => void;
