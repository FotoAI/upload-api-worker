import { env } from "cloudflare:workers";
import { jsonErrorResponse } from "../errors/error-handler";
import { buildOpenApiSpec } from "../openapi/build-spec";

async function timingSafeEqualUtf8(a: string, b: string) {
	const enc = new TextEncoder();
	const ba = enc.encode(a);
	const bb = enc.encode(b);
	if (ba.length !== bb.length) return false;
	return crypto.subtle.timingSafeEqual(ba, bb);
}

async function verifyDocsBasicAuth(authHeader: string | undefined) {
	const username = (env.DOCS_USERNAME as string | undefined) ?? "";
	const password = (env.DOCS_PASSWORD as string | undefined) ?? "";
	if (!username || !password) return { ok: false as const, reason: "not_configured" as const };

	if (!authHeader || !authHeader.startsWith("Basic ")) return { ok: false as const, reason: "missing" as const };

	let decoded: string;
	try {
		decoded = atob(authHeader.slice(6));
	} catch {
		return { ok: false as const, reason: "invalid" as const };
	}
	const colon = decoded.indexOf(":");
	if (colon < 0) return { ok: false as const, reason: "invalid" as const };
	const user = decoded.slice(0, colon);
	const pass = decoded.slice(colon + 1);
	const userOk = await timingSafeEqualUtf8(user, username);
	const passOk = await timingSafeEqualUtf8(pass, password);
	if (userOk && passOk) return { ok: true as const };
	return { ok: false as const, reason: "wrong" as const };
}

function swaggerUiHtml(openapiAbsoluteUrl: string) {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Upload API (v3)</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" crossorigin />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.onload = function () {
      SwaggerUIBundle({
        url: ${JSON.stringify(openapiAbsoluteUrl)},
        dom_id: "#swagger-ui",
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis],
        layout: "BaseLayout"
      });
    };
  </script>
</body>
</html>`;
}

function buildOriginFromRequest(request: Request): string {
	const url = new URL(request.url);
	return `${url.protocol}//${url.host}`;
}

function buildDocsUnauthorizedResponse(reason: "not_configured" | "missing" | "invalid" | "wrong"): Response {
	if (reason === "not_configured") {
		return jsonErrorResponse("INTERNAL_ERROR", {
			message: "Documentation is not configured. Set DOCS_USERNAME and DOCS_PASSWORD.",
			status: 503,
		});
	}
	return jsonErrorResponse("UNAUTHORIZED", {
		headers: { "WWW-Authenticate": 'Basic realm="Upload API Docs"' },
	});
}

export async function handleDocsOpenApiRoute(request: Request): Promise<Response> {
	const auth = await verifyDocsBasicAuth(request.headers.get("Authorization") ?? undefined);
	if (!auth.ok) {
		return buildDocsUnauthorizedResponse(auth.reason);
	}

	const origin = buildOriginFromRequest(request);
	const spec = buildOpenApiSpec(origin);
	return Response.json(spec, { status: 200, headers: { "Cache-Control": "no-store" } });
}

export async function handleDocsRoute(request: Request): Promise<Response> {
	const auth = await verifyDocsBasicAuth(request.headers.get("Authorization") ?? undefined);
	if (!auth.ok) {
		return buildDocsUnauthorizedResponse(auth.reason);
	}

	const origin = buildOriginFromRequest(request);
	const openapiUrl = `${origin}/upload-v3/docs/openapi.json`;
	return new Response(swaggerUiHtml(openapiUrl), {
		status: 200,
		headers: {
			"Cache-Control": "no-store",
			"Content-Type": "text/html;charset=UTF-8",
		},
	});
}

