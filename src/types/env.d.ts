/** Set at deploy time via `wrangler deploy --var ...` */
interface Env {
	SENTRY_RELEASE?: string;
	APP_VERSION?: string;
	GIT_SHA?: string;
	OTEL_SERVICE_NAME?: string;
	OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?: string;
	OTEL_EXPORTER_OTLP_LOGS_ENDPOINT?: string;
	APP_OTEL_DEBUG?: string;
}
