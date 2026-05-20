import * as Sentry from "@sentry/cloudflare";
import { withCorsHeaders, handleCorsPreflight } from "./middleware/cors.middleware";
import { authMiddleware } from "./middleware/auth.middleware";
import { handleUploadLegacyRoute, handleUploadRoute } from "./routes/upload.routes";
import {
	handleAbortMultipartRoute,
	handleCompleteMultipartRoute,
	handleStartMultipartRoute,
	handleUploadPartRoute,
} from "./routes/multipart.routes";
import { handlePublicFaceRoute } from "./routes/public.routes";
import { handleDocsOpenApiRoute, handleDocsRoute } from "./routes/docs.routes";
import { handleDebugSentryRoute } from "./routes/debug.routes";
import { errorHandler, notFoundHandler, reportErrorToSentry } from "./errors/error-handler";
import { getSentryOptions } from "./sentry/config";

const protectedPaths = new Set([
	"/upload-worker-s3",
	"/upload-v3/upload",
	"/upload-v3/start-multipart",
	"/upload-v3/upload-part",
	"/upload-v3/complete-multipart",
	"/upload-v3/abort-multipart",
]);

async function routeRequest(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const path = url.pathname;

	if (path === "/upload-v3/health" && request.method === "GET") {
		return Response.json({ ok: true, message: "ok" }, { status: 200 });
	}

	if (path === "/upload-v3/debug-sentry" && request.method === "GET") {
		return handleDebugSentryRoute(request);
	}

	if (path === "/upload-v3/docs/openapi.json" && request.method === "GET") {
		return handleDocsOpenApiRoute(request);
	}
	if (path === "/upload-v3/docs" && request.method === "GET") {
		return handleDocsRoute(request);
	}
	if (path === "/upload-v3/face" && request.method === "POST") {
		return handlePublicFaceRoute(request);
	}

	if (protectedPaths.has(path)) {
		await authMiddleware(request);
	}

	if (path === "/upload-v3/upload" && request.method === "POST") {
		return handleUploadRoute(request);
	}
	if (path === "/upload-worker-s3" && request.method === "POST") {
		return handleUploadLegacyRoute(request);
	}
	if (path === "/upload-v3/start-multipart" && request.method === "GET") {
		return handleStartMultipartRoute(request);
	}
	if (path === "/upload-v3/upload-part" && request.method === "POST") {
		return handleUploadPartRoute(request);
	}
	if (path === "/upload-v3/complete-multipart" && request.method === "POST") {
		return handleCompleteMultipartRoute(request);
	}
	if (path === "/upload-v3/abort-multipart" && request.method === "POST") {
		return handleAbortMultipartRoute(request);
	}

	notFoundHandler();
}

const worker = {
	async fetch(request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
		try {
			const preflightResponse = handleCorsPreflight(request);
			if (preflightResponse) return preflightResponse;
			const response = await routeRequest(request);
			return withCorsHeaders(response, request);
		} catch (error) {
			reportErrorToSentry(error);
			return withCorsHeaders(errorHandler(error), request);
		}
	},
} satisfies ExportedHandler<Env>;

export default Sentry.withSentry((env) => getSentryOptions(env), worker);
