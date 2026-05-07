import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import type { StaticHelpers } from "./types";

export const CONTENT_TYPES: Record<string, string> = {
	".css": "text/css; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".png": "image/png",
	".svg": "image/svg+xml",
	".txt": "text/plain; charset=utf-8",
	".webp": "image/webp",
	".woff": "font/woff",
	".woff2": "font/woff2",
};

export async function serveStaticAsset(
	requestPath: string,
	response: ServerResponse,
	headOnly: boolean,
	appRoot: string,
	helper: StaticHelpers,
): Promise<void> {
	const distDir = join(appRoot, "dist");
	if (!existsSync(distDir)) {
		helper.sendJson(response, 404, { error: "Frontend build not found. Run `vite build` first." });
		return;
	}

	const pathname = requestPath === "/" ? "/index.html" : requestPath;
	const safePath = normalize(pathname).replace(/^\.+/, "");
	let filePath = resolve(distDir, `.${safePath}`);

	if (!filePath.startsWith(distDir)) {
		helper.sendJson(response, 403, { error: "Forbidden." });
		return;
	}

	let fileStat;
	try {
		fileStat = await stat(filePath);
		if (fileStat.isDirectory()) {
			filePath = join(filePath, "index.html");
			fileStat = await stat(filePath);
		}
	} catch {
		filePath = join(distDir, "index.html");
		fileStat = await stat(filePath);
	}

	const extension = extname(filePath);
	response.writeHead(200, {
		"Content-Length": fileStat.size,
		"Content-Type": CONTENT_TYPES[extension] || "application/octet-stream",
	});

	if (headOnly) {
		response.end();
		return;
	}

	createReadStream(filePath).pipe(response);
}
