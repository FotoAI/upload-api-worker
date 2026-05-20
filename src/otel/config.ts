import type { ResolveConfigFn } from "@microlabs/otel-cf-workers";
import { createTracePropagator } from "./propagator";
import { NoopSpanExporter } from "./noop-exporter";

/** `OTEL_DISABLE_TRACES=true` / `1` / `yes` (case-insensitive). Empty or unset = traces not disabled by this flag. */
function isOtelTracesDisabled(value: string | undefined): boolean {
	if (value == null) return false;
	const v = value.trim().toLowerCase();
	return v === "true" || v === "1" || v === "yes";
}

export const resolveOtelConfig: ResolveConfigFn = (env: Env) => {
	const serviceName = env.OTEL_SERVICE_NAME ?? "upload-worker";

	const tracesExportOptOut = isOtelTracesDisabled(
		(env as Env & { OTEL_DISABLE_TRACES?: string }).OTEL_DISABLE_TRACES,
	);

	if (tracesExportOptOut || !env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) {
		return {
			service: { name: serviceName, version: env.SENTRY_RELEASE },
			exporter: new NoopSpanExporter(),
			sampling: { headSampler: { ratio: 0, acceptRemote: false } },
		};
	}

	return {
		service: { name: serviceName, version: env.SENTRY_RELEASE },
		exporter: {
			url: env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
		},
		propagator: createTracePropagator(),
		handlers: {
			fetch: {
				acceptTraceContext: true,
			},
		},
		fetch: {
			includeTraceContext: true,
		},
		sampling: {
			headSampler: { ratio: 1, acceptRemote: true },
		},
	};
};
