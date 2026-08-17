import { env, waitUntil } from "cloudflare:workers";
import { retryWithExponentialBackoff } from "../utils/retry";
import type { UploadHeaders } from "../http/headers";
import { AppError } from "../errors/app-error";

export type TraceContextHeaders = {
	traceparent?: string;
	tracestate?: string;
	baggage?: string;
	sentryTrace?: string;
};

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

	schedulePostImageProcess(
		headerValues: UploadHeaders,
		b2Id: string,
		foUploadId?: string,
		replace?: boolean,
		traceContext?: TraceContextHeaders,
	) {
		waitUntil(
			this.postImageProcess(headerValues, b2Id, foUploadId, replace, traceContext).catch((e) => {
				console.error("[JirayaService] postImageProcess failed:", e);
				return undefined;
			}),
		);
	}

	scheduleDeleteImage(headerValues: UploadHeaders, traceContext?: TraceContextHeaders) {
		waitUntil(this.deleteImage(headerValues, traceContext).catch(() => undefined));
	}

	async postImageProcess(
		headerValues: UploadHeaders,
		b2Id: string,
		foUploadId?: string,
		replace?: boolean,
		traceContext?: TraceContextHeaders,
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
		});

		console.log("[JirayaService] postImageProcess body", {
			body,
		});

		// const res = await retryWithExponentialBackoff(
		// 	() => fetch(url, { method: "POST", headers: this.buildRequestHeaders(traceContext), body }),
		// 	{
		// 		maxAttempts: 5,
		// 		baseDelayMs: 500,
		// 		shouldRetry: (res) => res.status >= 500 && res.status < 600,
		// 	},
		// ).catch((e) => {
		// 	throw new AppError("UPSTREAM_JIRAYA_FAILED", { details: { reason: "postImageProcess", error: String(e) } });
		// });
		try {
			const res = await fetch(url, { method: "POST", headers: this.buildRequestHeaders(traceContext), body });
			const responseBody = await res
				.clone()
				.text()
				.catch(() => "<unreadable>");
			console.log("[JirayaService] postImageProcess response", {
				status: res.status,
				ok: res.ok,
				body: responseBody,
			});
			return res;
		} catch (e) {
			throw new AppError("UPSTREAM_JIRAYA_FAILED", { details: { reason: "postImageProcess", error: String(e) } });
		}


	}

	async deleteImage(headerValues: UploadHeaders, traceContext?: TraceContextHeaders): Promise<Response> {
		const url = `${this.endpoint}/internal/image/delete`;
		const body = JSON.stringify({ path: headerValues.rawPath });

		const res = await retryWithExponentialBackoff(
			() => fetch(url, { method: "DELETE", headers: this.buildRequestHeaders(traceContext), body }),
			{
				maxAttempts: 5,
				baseDelayMs: 500,
				shouldRetry: (res) => res.status >= 500 && res.status < 600,
			},
		).catch((e) => {
			throw new AppError("UPSTREAM_JIRAYA_FAILED", { details: { reason: "deleteImage", error: String(e) } });
		});

		console.log("[JirayaService] deleteImage response", {
			status: res.status,
			ok: res.ok,
		});

		return res;
	}

	private buildRequestHeaders(traceContext?: TraceContextHeaders): Headers {
		const headers = new Headers(this.headers);
		if (traceContext?.traceparent) headers.set("traceparent", traceContext.traceparent);
		if (traceContext?.tracestate) headers.set("tracestate", traceContext.tracestate);
		if (traceContext?.baggage) headers.set("baggage", traceContext.baggage);
		if (traceContext?.sentryTrace) headers.set("sentry-trace", traceContext.sentryTrace);
		return headers;
	}
}

