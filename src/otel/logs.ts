import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { trace } from "@opentelemetry/api";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";

let logProvider: LoggerProvider | undefined;
let consolePatched = false;

const originalConsole = {
	log: console.log.bind(console),
	info: console.info.bind(console),
	warn: console.warn.bind(console),
	error: console.error.bind(console),
};

const SEVERITY = {
	log: SeverityNumber.INFO,
	info: SeverityNumber.INFO,
	warn: SeverityNumber.WARN,
	error: SeverityNumber.ERROR,
} as const;

type ConsoleLevel = keyof typeof SEVERITY;

function formatLogBody(args: unknown[]): string {
	return args
		.map((arg) => {
			if (typeof arg === "string") return arg;
			try {
				return JSON.stringify(arg);
			} catch {
				return String(arg);
			}
		})
		.join(" ");
}

function otelDebug(env: Env, message: string, data?: Record<string, unknown>): void {
	if (env.APP_OTEL_DEBUG !== "true") return;
	originalConsole.info(`[otel] ${message}`, data ?? "");
}

/** Initializes OTLP log export and patches console to emit log records. */
export function initOtelLogs(env: Env): void {
	if (!env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT) return;

	if (!logProvider) {
		const exporter = new OTLPLogExporter({
			url: env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT,
		});

		logProvider = new LoggerProvider({
			resource: resourceFromAttributes({
				"service.name": env.OTEL_SERVICE_NAME ?? "upload-worker",
				"deployment.environment": env.ENV,
			}),
			processors: [new BatchLogRecordProcessor(exporter)],
		});

		logs.setGlobalLoggerProvider(logProvider);
		otelDebug(env, "log provider initialized", { endpoint: env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT });
	}

	if (consolePatched) return;
	consolePatched = true;

	// Capture the logger at patch time — tied to the provider registered above.
	const logger = logs.getLogger(env.OTEL_SERVICE_NAME ?? "upload-worker");

	const emit = (level: ConsoleLevel, originalFn: (...args: unknown[]) => void, args: unknown[]) => {
		const body = formatLogBody(args);
		const spanContext = trace.getActiveSpan()?.spanContext();
		logger.emit({
			severityNumber: SEVERITY[level],
			severityText: level.toUpperCase(),
			body,
			attributes: {
				"log.source": "console",
				"log.level": level,
			},
			...(spanContext?.traceId && spanContext.spanId
				? { traceId: spanContext.traceId, spanId: spanContext.spanId }
				: {}),
		});
		otelDebug(env, `console.${level}`, { body });
		originalFn(...args);
	};

	console.log = (...args: unknown[]) => emit("log", originalConsole.log, args);
	console.info = (...args: unknown[]) => emit("info", originalConsole.info, args);
	console.warn = (...args: unknown[]) => emit("warn", originalConsole.warn, args);
	console.error = (...args: unknown[]) => emit("error", originalConsole.error, args);
}

export async function flushOtelLogs(): Promise<void> {
	if (!logProvider) return;
	try {
		await logProvider.forceFlush();
	} catch (e) {
		// OTLP collectors sometimes return 5xx with "internal error; reference = …".
		// Rejecting here causes Wrangler "Uncaught Error" because `waitUntil(flushOtelLogs())` has no catch.
		// Use original console to avoid feeding another OTLP batch while flushing failed.
		originalConsole.error("[otel] log export flush failed:", e);
	}
}
