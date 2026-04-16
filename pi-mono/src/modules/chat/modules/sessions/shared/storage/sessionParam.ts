export function updateSessionParam(sessionId?: string): void {
	const url = new URL(window.location.href);
	if (sessionId) {
		url.searchParams.set("session", sessionId);
	} else {
		url.searchParams.delete("session");
	}
	window.history.replaceState({}, "", url.toString());
}
