import { AwsClient } from "aws4fetch";
import { Builder, parseStringPromise } from "xml2js";
import { env } from "cloudflare:workers";
import { trace, context, propagation, SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { AppError } from "../errors/app-error";

type StartMultipartResult = {
	ok: true;
	data: { uploadId: string; bucket: string; key: string };
};

export class B2Service {
	private readonly aws: AwsClient;
	private readonly endpoint: string;

	constructor() {
		this.aws = new AwsClient({
			accessKeyId: env.B2_APPLICATION_KEY_ID as string,
			secretAccessKey: env.B2_APPLICATION_KEY as string,
			region: env.B2_REGION as string,
		});
		this.endpoint = env.B2_ENDPOINT as string;
	}

	async startMultipart(key: string, contentType?: string): Promise<StartMultipartResult> {
		const headers = new Headers();
		if (contentType) headers.append("Content-Type", contentType);

		const response = await this.tracedFetch("B2 startMultipart", `${this.endpoint}/${key}?uploads`, {
			method: "POST",
			headers,
		});
		const body = await response.text();
		if (!response.ok) {
			throw new AppError("UPSTREAM_B2_FAILED", {
				details: { status: response.status, body: body.slice(0, 2000) },
			});
		}

		const result = await parseStringPromise(body);
		const r = result?.InitiateMultipartUploadResult;
		const { Bucket, Key, UploadId } = r ?? {};
		if (!Bucket?.[0] || !Key?.[0] || !UploadId?.[0]) {
			throw new AppError("UPSTREAM_B2_FAILED", { details: { reason: "Unexpected XML response" } });
		}

		return {
			ok: true,
			data: { uploadId: UploadId[0], bucket: Bucket[0], key: Key[0] },
		};
	}

	async abortMultipart(uploadId: string, key: string): Promise<void> {
		const response = await this.tracedFetch("B2 abortMultipart", `${this.endpoint}/${key}?uploadId=${uploadId}`, { method: "DELETE" });
		if (response.status === 204) {
			return;
		}
		const bodyText = await response.text();
		throw new AppError("UPSTREAM_B2_FAILED", {
			details: { status: response.status, uploadId, body: bodyText.slice(0, 2000) },
		});
	}

	async completeMultipart(
		key: string,
		uploadId: string,
		parts: Array<{ etag: string; partNumber: string; sha1?: string | null }>,
	): Promise<Response> {
		const builder = new Builder();
		const formatParts = parts.map((p) => ({
			ETag: p.etag,
			PartNumber: p.partNumber,
			ChecksumSHA1: p.sha1 ?? undefined,
		}));
		const xmlBody = builder.buildObject({
			CompleteMultipartUpload: {
				$: { xmlns: "http://s3.amazonaws.com/doc/2006-03-01/" },
				Part: formatParts,
			},
		});

		return this.tracedFetch("B2 completeMultipart", `${this.endpoint}/${key}?uploadId=${uploadId}`, { method: "POST", body: xmlBody });
	}

	async upload(body: BodyInit, key: string, contentType?: string, sha1?: string): Promise<Response> {
		const headers = new Headers();
		if (contentType) headers.append("Content-Type", contentType);
		if (sha1) headers.append("X-Bz-Content-Sha1", sha1);

		return this.tracedFetch("B2 upload", `${this.endpoint}/${key}`, {
			method: "PUT",
			body,
			headers,
		});
	}

	async uploadPart(
		body: BodyInit,
		key: string,
		uploadId: string,
		partNumber: string,
		opts: { contentLength?: string; md5?: string; sha1?: string },
	): Promise<{ etag: string | null; "x-amz-id-2": string | null; partNumber: string; sha1: string | null }> {
		const requestHeaders = new Headers();
		if (opts.contentLength) requestHeaders.append("Content-Length", opts.contentLength);
		if (opts.md5) requestHeaders.append("Content-MD5", opts.md5);

		const response = await this.tracedFetch(
			"B2 uploadPart",
			`${this.endpoint}/${key}?partNumber=${encodeURIComponent(partNumber)}&uploadId=${encodeURIComponent(uploadId)}`,
			{ method: "PUT", body, headers: requestHeaders },
		);
		if (!response.ok) {
			const bodyText = await response.text();
			if (response.status === 404) {
				throw new AppError("MULTIPART_UPLOAD_NOT_FOUND", {
					message: "Multipart upload session not found. Start multipart upload again and retry.",
					details: {
						status: response.status,
						uploadId,
						partNumber,
						body: bodyText.slice(0, 2000),
					},
				});
			}
			throw new AppError("UPSTREAM_B2_FAILED", {
				details: {
					status: response.status,
					uploadId,
					partNumber,
					body: bodyText.slice(0, 2000),
				},
			});
		}

		return {
			etag: response.headers.get("ETag"),
			"x-amz-id-2": response.headers.get("x-amz-id-2"),
			partNumber,
			sha1: opts.sha1 ?? null,
		};
	}

	/** Wraps aws4fetch in an OTel CLIENT span and injects W3C traceparent propagation headers. */
	private async tracedFetch(spanName: string, url: string, init: RequestInit): Promise<Response> {
		const tracer = trace.getTracer("b2-service");
		const activeCtx = context.active();
		const span = tracer.startSpan(spanName, {
			kind: SpanKind.CLIENT,
			attributes: { "http.method": String(init.method ?? "GET"), "http.url": url },
		}, activeCtx);
		const spanCtx = trace.setSpan(activeCtx, span);
		const sc = span.spanContext();

		// console.info(`[b2] tracedFetch start`, { span: spanName, traceId: sc.traceId, spanId: sc.spanId, traceFlags: sc.traceFlags });

		try {
			const response = await context.with(spanCtx, () => {
				// Inject OTel context into the headers before aws4fetch signs the request.
				const headers = init.headers instanceof Headers ? init.headers : new Headers(init.headers as HeadersInit | undefined);
				propagation.inject(context.active(), headers, {
					set: (carrier: Headers, key: string, value: string) => carrier.set(key, value),
				});
				// console.info(`[b2] outbound traceparent`, { traceparent: headers.get("traceparent"), span: spanName });
				return this.aws.fetch(url, { ...init, headers });
			});
			span.setAttribute("http.status_code", response.status);
			span.setStatus({ code: response.status >= 500 ? SpanStatusCode.ERROR : SpanStatusCode.OK });
			// console.info(`[b2] tracedFetch done`, { span: spanName, status: response.status, traceId: sc.traceId, spanId: sc.spanId });
			return response;
		} catch (e) {
			span.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
			// console.error(`[b2] tracedFetch error`, { span: spanName, error: String(e), traceId: sc.traceId, spanId: sc.spanId });
			throw e;
		} finally {
			span.end();
		}
	}
}

