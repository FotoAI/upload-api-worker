import { B2Service } from "../services/b2.service";
import { JirayaService } from "../services/jiraya.service";
import { parseUploadHeaders } from "../http/headers";
import { isFileSizeExceededError, validateContentLengthHeader } from "../http/stream-size";
import { AppError } from "../errors/app-error";
import { requireImageOrVideoContentType } from "../http/content-type";
import { buildOkBody, jsonOkResponse } from "../http/responses";

const MAX_SINGLE_UPLOAD_BYTES = 1024 * 1024 * 35; // 35MB

const b2 = new B2Service();
const jiraya = new JirayaService();

type UploadResult = {
	body: ReturnType<typeof buildOkBody>;
	/** Background tasks that must complete before the OTel flush fires. */
	background: Promise<unknown>[];
};

async function handleUpload(request: Request): Promise<UploadResult> {
	const background: Promise<unknown>[] = [];
	const headerValues = parseUploadHeaders(request.headers);
	const contentType = requireImageOrVideoContentType(headerValues.contentType);
	const foUploadId = headerValues.foUploadId ?? crypto.randomUUID();
	const replace = Boolean(headerValues.foUploadId);
	console.info("[upload] start", { key: headerValues.bucketKey, contentType, foUploadId, replace });

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
		console.error("[upload] b2 upload threw", { key: headerValues.bucketKey, error: String(e) });
		throw new AppError("UPSTREAM_B2_FAILED", { details: { error: String(e) } });
	}

	if (res.status >= 400) {
		console.error("[upload] b2 error response", { key: headerValues.bucketKey, status: res.status });
		if (headerValues.isCallback === "1") {
			background.push(jiraya.deleteImageBackground(headerValues));
		}
		throw new AppError("UPSTREAM_B2_FAILED", { details: { status: res.status } });
	}

	const b2Id = res.headers.get("x-amz-version-id") ?? headerValues.uploadId ?? null;
	console.info("[upload] complete", { key: headerValues.bucketKey, b2Id, foUploadId, isCallback: headerValues.isCallback });
	if (res.status === 200 && headerValues.isCallback === "1" && b2Id) {
		background.push(jiraya.postImageProcessBackground(headerValues, b2Id, foUploadId, replace));
	}

	return {
		body: buildOkBody("Image Upload Successfully", {
			name: headerValues.imageName,
			id: headerValues.imageName,
			height: headerValues.imageHeight,
			width: headerValues.imageWidth,
			sha: headerValues.sha1,
			b2Id: b2Id ?? undefined,
			fo_upload_id: foUploadId,
		}),
		background,
	};
}

export async function handleUploadRoute(
	request: Request,
	background: Promise<unknown>[],
): Promise<Response> {
	const result = await handleUpload(request);
	background.push(...result.background);
	return jsonOkResponse(result.body.message, result.body.data);
}

export async function handleUploadLegacyRoute(
	request: Request,
	background: Promise<unknown>[],
): Promise<Response> {
	const result = await handleUpload(request);
	background.push(...result.background);
	return jsonOkResponse(result.body.message, result.body.data);
}
