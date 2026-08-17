import { env, waitUntil } from "cloudflare:workers";
import { B2Service } from "../services/b2.service";
import { JirayaService } from "../services/jiraya.service";
import { parseUploadHeaders } from "../http/headers";
import { FileSizeExceededError, validateContentLengthHeader } from "../http/stream-size";
import { AppError } from "../errors/app-error";
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

		if (!request.body) {
			throw new AppError("INTERNAL_ERROR", { message: "Request body is required" });
		}

		// Pass request.body through unchanged; size is validated via Content-Length header only.
		const response = await b2.uploadPart(request.body, h.bucketKey, h.uploadId, h.partNumber, {
			contentLength: h.contentLength,
			md5: h.md5,
			sha1: h.sha1,
		});
		return Response.json(response, { status: 200 });
	} catch (e) {
		// Stream size error handling disabled while stream size check is off.
		// if (isFileSizeExceededError(e)) {
		// 	throw new AppError("PAYLOAD_TOO_LARGE", {
		// 		message: e.message,
		// 		details: { code: "FILE_SIZE_EXCEEDED" },
		// 	});
		// }
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
		const upstreamRes = await b2.completeMultipart(h.bucketKey, h.uploadId, parsedBody.data.parts);
		if (upstreamRes.status === 200 && h.isCallback === "1") {
			jiraya.schedulePostImageProcess(
				h,
				h.uploadId,
				kvState?.fo_upload_id,
				kvState?.replace === true,
				traceContext,
			);
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
