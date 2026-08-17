import { B2Service } from "../services/b2.service";
import { JirayaService } from "../services/jiraya.service";
import { parseUploadHeaders } from "../http/headers";
import { isFileSizeExceededError, validateContentLengthHeader } from "../http/stream-size";
import { AppError } from "../errors/app-error";
import { requireImageOrVideoContentType } from "../http/content-type";

const MAX_SINGLE_UPLOAD_BYTES = 1024 * 1024 * 30; // 30MB

const b2 = new B2Service();
const jiraya = new JirayaService();

function getTraceContextHeaders(request: Request) {
	return {
		traceparent: request.headers.get("traceparent") ?? undefined,
		tracestate: request.headers.get("tracestate") ?? undefined,
		baggage: request.headers.get("baggage") ?? undefined,
		sentryTrace: request.headers.get("sentry-trace") ?? undefined,
	};
}

async function handleUpload(request: Request) {
	const headerValues = parseUploadHeaders(request.headers);
	const traceContext = getTraceContextHeaders(request);
	const contentType = requireImageOrVideoContentType(headerValues.contentType);
	const foUploadId = headerValues.foUploadId ?? crypto.randomUUID();
	const replace = Boolean(headerValues.foUploadId);

	// Early validation using Content-Length if present
	try {
		validateContentLengthHeader(request.headers, MAX_SINGLE_UPLOAD_BYTES);
	} catch (e) {
		if (isFileSizeExceededError(e)) {
			throw new AppError("PAYLOAD_TOO_LARGE", { message: e.message, details: { code: "FILE_SIZE_EXCEEDED" } });
		}
	}

	if (!request.body) {
		throw new AppError("INTERNAL_ERROR", { message: "Request body is required" });
	}

	let res: Response;
	try {
		// Pass request.body through unchanged; size is validated via Content-Length header only.
		res = await b2.upload(request.body, headerValues.bucketKey, contentType, headerValues.sha1);
	} catch (e) {
		console.error("[UploadRoutes] handleUpload error", { error: e });
		// Stream size error handling disabled while stream size check is off.
		// const isSizeError = isFileSizeExceededError(e);
		// if (isSizeError && headerValues.isCallback === "1") {
		// 	jiraya.scheduleDeleteImage(headerValues, traceContext);
		// }
		// if (isSizeError) {
		// 	throw new AppError("PAYLOAD_TOO_LARGE", {
		// 		message: (e as { message?: string })?.message ?? "Payload too large",
		// 		details: { code: "FILE_SIZE_EXCEEDED" },
		// 	});
		// }
		throw new AppError("UPSTREAM_B2_FAILED", { details: { error: String(e) } });
	}

	if (res.status >= 400) {
		console.error("[UploadRoutes] handleUpload error", { error: res.status });
		if (headerValues.isCallback === "1") {
			jiraya.scheduleDeleteImage(headerValues, traceContext);
		}
		throw new AppError("UPSTREAM_B2_FAILED", { details: { status: res.status } });
	}

	const b2Id = res.headers.get("x-amz-version-id") ?? headerValues.uploadId ?? null;
	if (res.status === 200 && headerValues.isCallback === "1" && b2Id) {
		jiraya.schedulePostImageProcess(headerValues, b2Id, foUploadId, replace, traceContext);
	}

	return {
		ok: true as const,
		message: "Image Upload Successfully",
		data: {
			name: headerValues.imageName,
			id: headerValues.imageName,
			height: headerValues.imageHeight,
			width: headerValues.imageWidth,
			sha: headerValues.sha1,
			b2Id: b2Id ?? undefined,
			fo_upload_id: foUploadId,
		},
	};
}

export async function handleUploadRoute(request: Request): Promise<Response> {
	const body = await handleUpload(request);
	return Response.json(body, { status: 200 });
}

export async function handleUploadLegacyRoute(request: Request): Promise<Response> {
	const body = await handleUpload(request);
	return Response.json(body, { status: 200 });
}
