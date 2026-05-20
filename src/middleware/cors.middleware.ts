const DEFAULT_ALLOW_METHODS = "GET,POST,PUT,DELETE,OPTIONS";

export function buildCorsHeaders(request: Request): Headers {
	const headers = new Headers();
	headers.set("Access-Control-Allow-Origin", "*");
	headers.set("Access-Control-Allow-Methods", DEFAULT_ALLOW_METHODS);
	headers.set("Access-Control-Max-Age", "86400");

	const reqHeaders = request.headers.get("Access-Control-Request-Headers");
	if (reqHeaders) {
		headers.set("Access-Control-Allow-Headers", reqHeaders);
	}
	return headers;
}

export function withCorsHeaders(response: Response, request: Request): Response {
	const nextHeaders = new Headers(response.headers);
	for (const [key, value] of buildCorsHeaders(request)) {
		nextHeaders.set(key, value);
	}
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: nextHeaders,
	});
}

export function handleCorsPreflight(request: Request): Response | null {
	if (request.method !== "OPTIONS") return null;
	return new Response(null, { status: 204, headers: buildCorsHeaders(request) });
}
