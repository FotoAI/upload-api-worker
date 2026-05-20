import * as Sentry from "@sentry/cloudflare";

/**
 * Test endpoint for Sentry error monitoring and logs.
 * GET /upload-v3/debug-sentry?mode=throw|capture|log|span
 */
export async function handleDebugSentryRoute(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const mode = url.searchParams.get("mode") ?? "throw";

	Sentry.logger.info("debug-sentry endpoint hit", { mode });

	switch (mode) {
		case "log": {
			console.log("[debug-sentry] console.log test", { timestamp: Date.now() });
			console.warn("[debug-sentry] console.warn test");
			Sentry.logger.warn("debug-sentry Sentry.logger test", { mode: "log" });
			return Response.json({
				ok: true,
				message: "Sent console.* and Sentry.logger messages — check Sentry Logs",
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
			return Sentry.startSpan({ op: "test", name: "debug-sentry" }, async () => {
				await new Promise((resolve) => setTimeout(resolve, 50));
				throw new Error("debug-sentry error inside Sentry.startSpan");
			});
		}
		case "throw":
		default:
			throw new Error("debug-sentry thrown test error");
	}
}
