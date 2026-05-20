import * as Sentry from "@sentry/cloudflare";
import type { CloudflareOptions } from "@sentry/cloudflare";

export function getSentryOptions(env: Env): CloudflareOptions | undefined {
	if (!env.SENTRY_DSN) {
		return undefined;
	}

	return {
		dsn: env.SENTRY_DSN,
		release: env.SENTRY_RELEASE,
		environment: env.ENV,
		sendDefaultPii: true,
		enableLogs: true,
		tracesSampleRate: env.ENV === "prod" ? 0.1 : 1.0,
		integrations: (integrations) => [
			...integrations,
			Sentry.consoleLoggingIntegration({ levels: ["log", "warn", "error"] }),
		],
	};
}
