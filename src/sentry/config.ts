import type { CloudflareOptions } from "@sentry/cloudflare";

/** Sentry is used for error monitoring only; traces and logs go to OTEL. */
export function getSentryOptions(env: Env): CloudflareOptions | undefined {
	if (!env.SENTRY_DSN) {
		return undefined;
	}

	return {
		dsn: env.SENTRY_DSN,
		release: env.SENTRY_RELEASE,
		environment: env.ENV,
		sendDefaultPii: true,
		enableLogs: false,
		tracesSampleRate: 0,
		skipOpenTelemetrySetup: true,
		integrations: (integrations) =>
			integrations.filter((integration) => integration.name !== "Console"),
	};
}
