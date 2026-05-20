import { env, waitUntil } from "cloudflare:workers";
import { B2Service } from "../services/b2.service";
import { JirayaService } from "../services/jiraya.service";
import { ImageMetadataService } from "../services/image-metadata.service";
import { VideoMetadataService } from "../services/video-metadata.service";
import { parseUploadHeaders } from "../http/headers";
import {
	FileSizeExceededError,
	isFileSizeExceededError,
	validateContentLengthHeader,
} from "../http/stream-size";
import { AppError, isAppError } from "../errors/app-error";
import { CompleteMultipartBodySchema } from "../http/schemas";
import { requireImageOrVideoContentType } from "../http/content-type";

/** One part cannot exceed full single-image cap; video parts allow larger chunks for 6GB / 1000 parts clients. */
const MAX_MULTIPART_PART_BYTES_IMAGE = 30 * 1024 * 1024;
const MAX_MULTIPART_PART_BYTES_VIDEO = 128 * 1024 * 1024;

function maxBytesForMultipartPart(contentType: string): number {
	return contentType.startsWith("video/") ? MAX_MULTIPART_PART_BYTES_VIDEO : MAX_MULTIPART_PART_BYTES_IMAGE;
}

const b2 = new B2Service();
const jiraya = new JirayaService();
const imageMetadata = new ImageMetadataService();
const videoMetadata = new VideoMetadataService();
const MULTIPART_KV_TTL_SECONDS = 60 * 60 * 24; // 24 hours

function getTraceContextHeaders(request: Request) {
	return {
		traceparent: request.headers.get("traceparent") ?? undefined,
		tracestate: request.headers.get("tracestate") ?? undefined,
		baggage: request.headers.get("baggage") ?? undefined,
		sentryTrace: request.headers.get("sentry-trace") ?? undefined,
	};
}

type MultipartUploadKvValue = {
	fo_upload_id: string;
	metadata?: Record<string, unknown>;
	content_type?: string;
	bucket_key?: string;
	replace?: boolean;
	created_at: string;
	updated_at: string;
};

function getMultipartUploadsKv(): KVNamespace {
	const kv = (env as { MULTIPART_UPLOADS_KV?: KVNamespace }).MULTIPART_UPLOADS_KV;
	if (!kv) {
		throw new AppError("INTERNAL_ERROR", { message: "Missing MULTIPART_UPLOADS_KV binding" });
	}
	return kv;
}

async function putMultipartKv(uploadId: string, value: MultipartUploadKvValue): Promise<void> {
	await getMultipartUploadsKv().put(uploadId, JSON.stringify(value), { expirationTtl: MULTIPART_KV_TTL_SECONDS });
}

async function getMultipartKv(uploadId: string): Promise<MultipartUploadKvValue | null> {
	const raw = await getMultipartUploadsKv().get(uploadId);
	if (!raw) return null;
	try {
		return JSON.parse(raw) as MultipartUploadKvValue;
	} catch {
		return null;
	}
}

function logMultipartMetadataSeam(headerValues: ReturnType<typeof parseUploadHeaders>) {
	if (!imageMetadata.shouldExtractForContentType(headerValues.contentType)) return;
	console.log("[ImageMetadataService] multipart metadata extraction placeholder", {
		uploadId: headerValues.uploadId,
		bucketKey: headerValues.bucketKey,
		imageName: headerValues.imageName,
		contentType: headerValues.contentType,
	});
}


export async function handleStartMultipartRoute(request: Request): Promise<Response> {
	const h = parseUploadHeaders(request.headers);
	const contentType = requireImageOrVideoContentType(h.contentType);
	const foUploadId = h.foUploadId ?? crypto.randomUUID();
	const replace = Boolean(h.foUploadId);
	const response = await b2.startMultipart(h.bucketKey, contentType);
	const now = new Date().toISOString();
	await putMultipartKv(response.data.uploadId, {
		fo_upload_id: foUploadId,
		content_type: contentType,
		bucket_key: h.bucketKey,
		replace,
		created_at: now,
		updated_at: now,
	});
	return Response.json(
		{
			...response,
			data: {
				...response.data,
				fo_upload_id: foUploadId,
			},
		},
		{ status: 200 },
	);
}

export async function handleUploadPartRoute(request: Request): Promise<Response> {
	try {
		const h = parseUploadHeaders(request.headers);
		if (!h.uploadId) throw new AppError("MISSING_HEADER", { details: { header: "X-Bz-Upload-ID" } });
		if (!h.partNumber) throw new AppError("MISSING_HEADER", { details: { header: "X-Bz-Part-Number" } });
		const uploadId = h.uploadId;

		const partNumberInt = Number.parseInt(h.partNumber, 10);
		const contentType = requireImageOrVideoContentType(h.contentType);
		if (contentType.startsWith("video/") && !Number.isNaN(partNumberInt) && partNumberInt > 1000) {
			throw new AppError("PART_LIMIT_EXCEEDED", {
				message: "Maximum part limit exceeded. MP4 uploads are limited to 1000 parts (6GB total).",
			});
		}
		if (contentType.startsWith("image/") && !Number.isNaN(partNumberInt) && partNumberInt > 8) {
			throw new AppError("PART_LIMIT_EXCEEDED", {
				message: "Maximum part limit exceeded. Image uploads are limited to 8 parts (40MB total).",
			});
		}
		const partMax = maxBytesForMultipartPart(contentType);
		try {
			validateContentLengthHeader(request.headers, partMax);
		} catch (e) {
			if (e instanceof FileSizeExceededError) {
				throw new AppError("PAYLOAD_TOO_LARGE", { message: e.message, details: { code: "FILE_SIZE_EXCEEDED" } });
			}
			throw e;
		}

		const body = request.body ?? new ReadableStream<Uint8Array>();
		let uploadStream = body;
		const shouldExtractPartOneImageMetadata =
			h.partNumber === "1" && imageMetadata.shouldExtractForContentType(contentType);
		const shouldExtractPartOneVideoMetadata = h.partNumber === "1" && contentType.startsWith("video/");
		if (shouldExtractPartOneImageMetadata) {
			const [uploadBranch, metadataStream] = body.tee();
			uploadStream = uploadBranch;
			const requestId = crypto.randomUUID();
			waitUntil(
				imageMetadata
					.extractFromStream({
						stream: metadataStream,
						contentType,
						imageName: h.imageName,
						requestId,
					})
					.then((result) => {
						if (result.ok) {
							const metadataPayload = {
								parser: result.parser,
								bytesRead: result.bytesRead,
								truncated: result.truncated,
								imageName: result.imageName,
								contentType: result.contentType,
								tags: result.tags,
							};
							waitUntil(
								getMultipartKv(uploadId)
									.then((existing) => {
										if (!existing) return;
										return putMultipartKv(uploadId, {
											...existing,
											metadata: metadataPayload,
											updated_at: new Date().toISOString(),
										});
									})
									.catch(() => undefined),
							);
							console.log("[ImageMetadataService] extracted multipart part 1 metadata", {
								requestId,
								uploadId: h.uploadId,
								partNumber: h.partNumber,
								parser: result.parser,
								bytesRead: result.bytesRead,
								truncated: result.truncated,
								imageName: result.imageName,
								contentType: result.contentType,
								tags: result.tags,
							});
							return;
						}
						console.log("[ImageMetadataService] failed multipart part 1 metadata extraction", {
							requestId,
							uploadId: h.uploadId,
							partNumber: h.partNumber,
							parser: result.parser,
							bytesRead: result.bytesRead,
							truncated: result.truncated,
							imageName: result.imageName,
							contentType: result.contentType,
							error: result.error,
						});
					})
					.catch(() => undefined),
			);
		}
		// Attempt video metadata extraction from part 1 when parsable.
		// If part 1 does not contain enough container metadata, callback proceeds without metadata.
		if (shouldExtractPartOneVideoMetadata) {
			const [uploadBranch, metadataStream] = body.tee();
			uploadStream = uploadBranch;
			const requestId = crypto.randomUUID();
			waitUntil(
				videoMetadata
					.extractFromStream({
					stream: metadataStream,
					contentType,
					imageName: h.imageName,
					requestId,
				})
					.then((result) => {
						if (!result.ok) return;
						const metadataPayload = {
							parser: result.parser,
							bytesRead: result.bytesRead,
							imageName: result.imageName,
							contentType: result.contentType,
							tags: result.tags,
						};
						return getMultipartKv(uploadId)
							.then((existing) => {
								if (!existing) return;
								return putMultipartKv(uploadId, {
									...existing,
									metadata: metadataPayload,
									updated_at: new Date().toISOString(),
								});
							})
							.catch(() => undefined);
					})
					.catch(() => undefined),
			);
		}
		// const body = await readStreamToUint8ArrayWithLimit(request.body ?? new ReadableStream<Uint8Array>(), partMax);
		const response = await b2.uploadPart(uploadStream, h.bucketKey, h.uploadId, h.partNumber, {
			contentLength: h.contentLength,
			md5: h.md5,
			sha1: h.sha1,
		});
		return Response.json(response, { status: 200 });
	} catch (e) {
		if (isFileSizeExceededError(e)) {
			throw new AppError("PAYLOAD_TOO_LARGE", {
				message: e.message,
				details: { code: "FILE_SIZE_EXCEEDED" },
			});
		}
		throw e;
	}
}

export async function handleCompleteMultipartRoute(request: Request): Promise<Response> {
	const h = parseUploadHeaders(request.headers);
	const traceContext = getTraceContextHeaders(request);
	try {
		if (!h.uploadId) throw new AppError("MISSING_HEADER", { details: { header: "X-Bz-Upload-ID" } });

		const body = await request.json();
		const parsedBody = CompleteMultipartBodySchema.safeParse(body);
		if (!parsedBody.success) {
			throw new AppError("INVALID_JSON", { details: { issues: parsedBody.error.issues } });
		}

		const kvState = await getMultipartKv(h.uploadId);
		let extractedMetadata = kvState?.metadata;
		const upstreamRes = await b2.completeMultipart(h.bucketKey, h.uploadId, parsedBody.data.parts);
		if (upstreamRes.status === 200 && h.isCallback === "1") {
			jiraya.schedulePostImageProcess(
				h,
				h.uploadId,
				kvState?.fo_upload_id,
				extractedMetadata,
				kvState?.replace === true,
				traceContext,
			);
			// Reusable seam for future multipart metadata extraction pipeline.
			logMultipartMetadataSeam(h);
		}
		waitUntil(getMultipartUploadsKv().delete(h.uploadId).catch(() => undefined));

		return Response.json({ ok: true, message: "Upload Complete" }, { status: 200 });
	} catch (e) {
		if (e instanceof SyntaxError) throw new AppError("INVALID_JSON");
		throw e;
	}
}

export async function handleAbortMultipartRoute(request: Request): Promise<Response> {
	const h = parseUploadHeaders(request.headers);
	if (!h.uploadId) throw new AppError("MISSING_HEADER", { details: { header: "X-Bz-Upload-ID" } });
	const response = await b2.abortMultipart(h.uploadId, h.bucketKey);
	waitUntil(getMultipartUploadsKv().delete(h.uploadId).catch(() => undefined));
	return Response.json(response, { status: 200 });
}

