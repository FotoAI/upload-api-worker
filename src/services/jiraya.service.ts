import { env } from "cloudflare:workers";
import { trace, context, propagation, SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { retryWithExponentialBackoff } from "../utils/retry";
import type { UploadHeaders } from "../http/headers";
import { AppError } from "../errors/app-error";

export class JirayaService {
	private readonly endpoint: string;
	private readonly headers: Headers;

	constructor() {
		this.endpoint = env.API_HOST as string;
		this.headers = new Headers();
		this.headers.append(
			"Authorization",
			"Basic " + btoa(`${env.API_USERNAME as string}:${env.API_PASSWORD as string}`),
		);
		this.headers.append("Content-Type", "application/json");
	}

	/**
	 * Returns a promise for the background work so the caller can sequence it
	 * before the OTel flush via ctx.waitUntil. The caller must pass this promise
	 * to ctx.waitUntil — do NOT fire-and-forget it.
	 */
	/**
	 * Returns a promise for the background work so the caller can sequence it
	 * before the OTel flush via ctx.waitUntil. The caller must pass this promise
	 * to ctx.waitUntil — do NOT fire-and-forget it.
	 */
	postImageProcessBackground(
		headerValues: UploadHeaders,
		b2Id: string,
		foUploadId?: string,
		replace?: boolean,
	): Promise<void> {
		// Capture context while the request span is still active so the child span
		// is correctly parented even though this work runs after the response is sent.
		const capturedCtx = context.active();
		return context.with(capturedCtx, () =>
			this.postImageProcess(headerValues, b2Id, foUploadId, replace).then(
				() => undefined,
				(e) => { console.error("[jiraya] postImageProcess failed:", e); },
			),
		);
	}

	deleteImageBackground(headerValues: UploadHeaders): Promise<void> {
		const capturedCtx = context.active();
		return context.with(capturedCtx, () =>
			this.deleteImage(headerValues).then(() => undefined, () => undefined),
		);
	}

	async postImageProcess(
		headerValues: UploadHeaders,
		b2Id: string,
		foUploadId?: string,
		replace?: boolean,
	): Promise<Response> {
		const url = `${this.endpoint}/internal/event/picture/process`;
		const body = JSON.stringify({
			b2_id: b2Id,
			uuid: foUploadId,
			replace_image: replace,
			mime_type: headerValues.contentType,
			event_id: headerValues.eventId,
			collection_id: headerValues.collectionId,
			process_info_id: headerValues.processId,
			image_name: headerValues.imageName,
			user_id: headerValues.userId,
			height: headerValues.imageHeight,
			width: headerValues.imageWidth,
			size: headerValues.imageSize,
			path: headerValues.imagePath,
			raw_path: headerValues.rawPath,
			is_gallery: headerValues.isGallery,
			click_time: headerValues.datetime,
			collection_ids: headerValues.collectionIds,
			guest_upload: headerValues.isGuestUpload,
			compression_factor: headerValues.isCompression ? headerValues.compressionFactor : undefined,
			deduplicate_id: headerValues.deduplicateId,
		});

		console.info("[jiraya] postImageProcess", { eventId: headerValues.eventId, b2Id, foUploadId });

		return this.tracedFetch("POST /internal/event/picture/process", url, "POST", body);
	}

	async deleteImage(headerValues: UploadHeaders): Promise<Response> {
		const url = `${this.endpoint}/internal/image/delete`;
		const body = JSON.stringify({ path: headerValues.rawPath });

		console.info("[jiraya] deleteImage", { rawPath: headerValues.rawPath });

		return retryWithExponentialBackoff(
			() => this.tracedFetch("DELETE /internal/image/delete", url, "DELETE", body),
			{
				maxAttempts: 5,
				baseDelayMs: 500,
				shouldRetry: (res) => res.status >= 500 && res.status < 600,
			},
		).catch((e) => {
			throw new AppError("UPSTREAM_JIRAYA_FAILED", { details: { reason: "deleteImage", error: String(e) } });
		});
	}

	/** Wraps a single fetch in an OTel CLIENT span and injects W3C traceparent propagation headers. */
	private async tracedFetch(spanName: string, url: string, method: string, body: string): Promise<Response> {
		const tracer = trace.getTracer("jiraya-service");
		const activeCtx = context.active();
		const span = tracer.startSpan(spanName, { kind: SpanKind.CLIENT, attributes: { "http.method": method, "http.url": url } }, activeCtx);
		const spanCtx = trace.setSpan(activeCtx, span);
		const sc = span.spanContext();

		console.info(`[jiraya] tracedFetch start`, {
			span: spanName,
			traceId: sc.traceId,
			spanId: sc.spanId,
			traceFlags: sc.traceFlags,
		});

		try {
			const res = await context.with(spanCtx, () => {
				const headers = this.buildRequestHeaders();
				// Log the injected traceparent so we can verify the header value.
				console.info(`[jiraya] outbound traceparent`, { traceparent: headers.get("traceparent"), span: spanName });
				return fetch(url, { method, headers, body });
			});
			span.setAttribute("http.status_code", res.status);
			span.setStatus({ code: res.status >= 500 ? SpanStatusCode.ERROR : SpanStatusCode.OK });
			console.info(`[jiraya] tracedFetch done`, { span: spanName, status: res.status, traceId: sc.traceId, spanId: sc.spanId });
			return res;
		} catch (e) {
			span.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
			console.error(`[jiraya] tracedFetch error`, { span: spanName, error: String(e), traceId: sc.traceId, spanId: sc.spanId });
			throw new AppError("UPSTREAM_JIRAYA_FAILED", { details: { reason: spanName, error: String(e) } });
		} finally {
			span.end();
		}
	}

	/** Builds request headers with W3C traceparent injected from the active span context.
	 *  Must be called inside a context.with(spanCtx, ...) block to inject the correct span. */
	private buildRequestHeaders(): Headers {
		const headers = new Headers(this.headers);
		propagation.inject(context.active(), headers, {
			set: (carrier: Headers, key: string, value: string) => carrier.set(key, value),
		});
		return headers;
	}
}
