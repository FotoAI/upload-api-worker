import { CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator } from "@opentelemetry/core";
import type { TextMapPropagator } from "@opentelemetry/api";
import { SentryPropagator } from "@sentry/opentelemetry";

/** W3C traceparent + Sentry sentry-trace/baggage from the React client. */
export function createTracePropagator(): TextMapPropagator {
	return new CompositePropagator({
		propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator(), new SentryPropagator()],
	});
}
