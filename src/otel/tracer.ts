import { trace, context, propagation, SpanKind, SpanStatusCode } from "@opentelemetry/api";
import type { Span } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor, BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { createTracePropagator } from "./propagator";

let tracerProvider: BasicTracerProvider | undefined;
let contextManagerRegistered = false;

/**
 * Initializes the OTel TracerProvider once per isolate lifetime.
 * Safe to call on every request — repeated calls are no-ops.
 */
export function initOtelTracer(env: Env): void {
	if (tracerProvider) return;
	if (!env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) return;

	const exporter = new OTLPTraceExporter({ url: env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT });

	const provider = new BasicTracerProvider({
		resource: resourceFromAttributes({
			"service.name": env.OTEL_SERVICE_NAME ?? "upload-worker",
			"deployment.environment": env.ENV,
		}),
		spanProcessors: [new BatchSpanProcessor(exporter)],
	});

	// In OTel JS v2, BasicTracerProvider no longer has .register().
	// Global registration is done explicitly via the API singletons.
	trace.setGlobalTracerProvider(provider);
	propagation.setGlobalPropagator(createTracePropagator());

	// CRITICAL: Without a ContextManager, context.active() always returns ROOT_CONTEXT,
	// breaking all parent-child span relationships. Must be registered once.
	if (!contextManagerRegistered) {
		context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
		contextManagerRegistered = true;
	}

	tracerProvider = provider;
}

/**
 * Extracts trace context from inbound request headers and starts a root
 * server span. The caller MUST call `endFetchSpan` in a finally block.
 */
export function startFetchSpan(request: Request, serviceName: string): { span: Span; ctx: ReturnType<typeof context.active> } {
	const carrier: Record<string, string> = {};
	request.headers.forEach((value, key) => {
		carrier[key] = value;
	});

	const parentCtx = propagation.extract(context.active(), carrier);
	const tracer = trace.getTracer(serviceName);
	const url = new URL(request.url);

	const span = tracer.startSpan(
		`${request.method} ${url.pathname}`,
		{
			kind: SpanKind.SERVER,
			attributes: {
				"http.method": request.method,
				"http.target": url.pathname + (url.search || ""),
				"http.url": url.href,
				"http.host": url.host,
				"http.scheme": url.protocol.replace(":", ""),
			},
		},
		parentCtx,
	);

	return { span, ctx: trace.setSpan(parentCtx, span) };
}

export function endFetchSpan(span: Span, status: number): void {
	span.setAttribute("http.status_code", status);
	// Per OTel HTTP semantic conventions, only 5xx responses are errors.
	// 4xx are client errors and should not mark the server span as ERROR.
	if (status >= 500) {
		span.setStatus({ code: SpanStatusCode.ERROR });
	} else {
		span.setStatus({ code: SpanStatusCode.OK });
	}
	span.end();
}

export async function flushOtelTraces(): Promise<void> {
	if (!tracerProvider) return;
	try {
		await tracerProvider.forceFlush();
	} catch (e) {
		// Best-effort — never let flush failures surface as unhandled rejections.
		console.error("[otel] trace flush failed:", e);
	}
}
