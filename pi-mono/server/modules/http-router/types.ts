import type { IncomingMessage, ServerResponse } from "node:http";

export type RouteContext = {
	request: IncomingMessage;
	response: ServerResponse;
	url: URL;
	appRoot: string;
	workspaceRoot: string;
};
