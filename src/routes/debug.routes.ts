import * as Sentry from "@sentry/cloudflare";
import { SpanStatusCode, trace } from "@opentelemetry/api";

/**
 * Test endpoint for observability.
 * GET /upload-v3/debug-sentry?mode=throw|capture|log|span
 */
export async function handleDebugSentryRoute(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const mode = url.searchParams.get("mode") ?? "throw";

	switch (mode) {
		case "log": {
			console.log("[debug-sentry] console.log test", { timestamp: Date.now() });
			console.warn("[debug-sentry] console.warn test");
			console.error("[debug-sentry] console.error test");
			return Response.json({
				ok: true,
				message: "Sent console logs — check OTEL Logs (not Sentry)",
			});
		}
		case "capture": {
			Sentry.captureException(new Error("debug-sentry captureException test"));
			return Response.json({
				ok: true,
				message: "Captured exception via Sentry.captureException — check Sentry Issues",
			});
		}
		case "span": {
			const tracer = trace.getTracer("upload-worker");
			return tracer.startActiveSpan("debug-sentry", async (span) => {
				try {
					await new Promise((resolve) => setTimeout(resolve, 50));
					throw new Error("debug-sentry error inside OTEL span");
				} catch (error) {
					span.recordException(error as Error);
					span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
					throw error;
				} finally {
					span.end();
				}
			});
		}
		case "throw":
		default:
			throw new Error("debug-sentry thrown test error");
	}
}
