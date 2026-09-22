import * as Sentry from "@sentry/cloudflare";
import { context } from "@opentelemetry/api";
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
import { handleVersionRoute } from "./routes/version.routes";
import { errorHandler, notFoundHandler, reportErrorToSentry } from "./errors/error-handler";
import { jsonOkResponse } from "./http/responses";
import { getSentryOptions } from "./sentry/config";
import { initOtelTracer, startFetchSpan, endFetchSpan, flushOtelTraces } from "./otel/tracer";
import { flushOtelLogs, initOtelLogs } from "./otel/logs";

const protectedPaths = new Set([
	"/upload-worker-s3",
	"/upload-v3/upload",
	"/upload-v3/start-multipart",
	"/upload-v3/upload-part",
	"/upload-v3/complete-multipart",
	"/upload-v3/abort-multipart",
]);

async function routeRequest(request: Request, env: Env, background: Promise<unknown>[]): Promise<Response> {
	const url = new URL(request.url);
	const path = url.pathname;

	if (path === "/upload-v3/health" && request.method === "GET") {
		return jsonOkResponse("ok");
	}

	if (path === "/upload-v3/version" && request.method === "GET") {
		return handleVersionRoute(env);
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
		return handleUploadRoute(request, background);
	}
	if (path === "/upload-worker-s3" && request.method === "POST") {
		return handleUploadLegacyRoute(request, background);
	}
	if (path === "/upload-v3/start-multipart" && request.method === "GET") {
		return handleStartMultipartRoute(request);
	}
	if (path === "/upload-v3/upload-part" && request.method === "POST") {
		return handleUploadPartRoute(request);
	}
	if (path === "/upload-v3/complete-multipart" && request.method === "POST") {
		return handleCompleteMultipartRoute(request, background);
	}
	if (path === "/upload-v3/abort-multipart" && request.method === "POST") {
		return handleAbortMultipartRoute(request);
	}

	notFoundHandler();
}

const worker = {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		initOtelLogs(env);
		initOtelTracer(env);

		const serviceName = env.OTEL_SERVICE_NAME ?? "upload-worker";
		const { span, ctx: spanCtx } = startFetchSpan(request, serviceName);
		const sc = span.spanContext();

		// Collects background work (e.g. Jiraya postImageProcess) that must complete
		// BEFORE the OTel flush, so their spans are included in the export.
		const background: Promise<unknown>[] = [];

		let response: Response | undefined;
		try {
			response = await context.with(spanCtx, async () => {
				const url = new URL(request.url);
				console.info("[worker] request", {
					method: request.method,
					path: url.pathname,
					traceId: sc.traceId,
					spanId: sc.spanId,
					traceFlags: sc.traceFlags,
				});
				const preflightResponse = handleCorsPreflight(request);
				if (preflightResponse) return preflightResponse;
				const res = await routeRequest(request, env, background);
				console.info("[worker] response", { status: res.status, traceId: sc.traceId, spanId: sc.spanId });
				return withCorsHeaders(res, request);
			});
		} catch (error) {
			console.error("[worker] unhandled error", { error });
			reportErrorToSentry(error);
			response = withCorsHeaders(errorHandler(error), request);
		} finally {
			endFetchSpan(span, response?.status ?? 500);
			// Flush AFTER background work settles so Jiraya spans are exported.
			// Best-effort — allSettled ensures flush always runs even if background tasks fail.
			ctx.waitUntil(
				Promise.allSettled(background).then(() =>
					Promise.allSettled([flushOtelLogs(), flushOtelTraces()])
				)
			);
		}

		// response is always set: either from the try block or the catch block
		return response!;
	},
} satisfies ExportedHandler<Env>;

export default Sentry.withSentry((env) => getSentryOptions(env), worker);
