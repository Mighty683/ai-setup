import type { ServerResponse } from "node:http";

export type StaticHelpers = {
	sendJson: (response: ServerResponse, statusCode: number, body: unknown) => void;
};
