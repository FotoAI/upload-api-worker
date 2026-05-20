import { env, waitUntil } from "cloudflare:workers";
import { B2Service } from "../services/b2.service";
import { JirayaService } from "../services/jiraya.service";
import { ImageMetadataService } from "../services/image-metadata.service";
import { VideoMetadataService } from "../services/video-metadata.service";
import { parseUploadHeaders } from "../http/headers";
import { FileSizeExceededError, isFileSizeExceededError, validateContentLengthHeader } from "../http/stream-size";
import { AppError } from "../errors/app-error";
import { requireImageOrVideoContentType } from "../http/content-type";

const MAX_SINGLE_UPLOAD_BYTES = 1024 * 1024 * 30; // 30MB

const b2 = new B2Service();
const jiraya = new JirayaService();
const imageMetadata = new ImageMetadataService();
const videoMetadata = new VideoMetadataService();

async function handleUpload(request: Request) {
	const headerValues = parseUploadHeaders(request.headers);
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

	let res: Response;
	let extractedMetadata: Record<string, unknown> | undefined;
	try {
		const webStream = request.body ?? new ReadableStream<Uint8Array>();
		let uploadStream = webStream;
		const requestId = crypto.randomUUID();
		let imageMetadataPromise: Promise<import("../services/image-metadata.service").ExtractImageMetadataResult> | undefined;
		let videoMetadataPromise: Promise<import("../services/video-metadata.service").ExtractVideoMetadataResult> | undefined;

		if (imageMetadata.shouldExtractForContentType(contentType)) {
			const [uploadBranch, metadataStream] = webStream.tee();
			uploadStream = uploadBranch;
			imageMetadataPromise = imageMetadata.extractFromStream({
				stream: metadataStream,
				contentType,
				imageName: headerValues.imageName,
				requestId,
			});
		}
		if (videoMetadata.shouldExtractForContentType(contentType)) {
			const [uploadBranch, metadataStream] = webStream.tee();
			uploadStream = uploadBranch;
			videoMetadataPromise = videoMetadata.extractFromStream({
				stream: metadataStream,
				contentType,
				imageName: headerValues.imageName,
				requestId,
			});
		}

		// const bodyBytes = await readStreamToUint8ArrayWithLimit(uploadStream, MAX_SINGLE_UPLOAD_BYTES);
		res = await b2.upload(uploadStream, headerValues.bucketKey, contentType, headerValues.sha1);
		if (imageMetadataPromise) {
			waitUntil(
				imageMetadataPromise
					.then((result) => {
						if (result.ok) {
							extractedMetadata = {
								parser: result.parser,
								bytesRead: result.bytesRead,
								truncated: result.truncated,
								imageName: result.imageName,
								contentType: result.contentType,
								tags: result.tags,
							};
							console.log("[ImageMetadataService] extracted metadata", {
								requestId,
								...extractedMetadata,
							});
							return;
						}
						console.log("[ImageMetadataService] failed metadata extraction", {
							requestId,
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
			const metadataResult = await imageMetadataPromise.catch(() => undefined);
			if (metadataResult?.ok) {
				extractedMetadata = {
					parser: metadataResult.parser,
					bytesRead: metadataResult.bytesRead,
					truncated: metadataResult.truncated,
					imageName: metadataResult.imageName,
					contentType: metadataResult.contentType,
					tags: metadataResult.tags,
				};
			}
		}
		if (videoMetadataPromise) {
			let resolvedVideoMetadata = await videoMetadataPromise.catch(() => undefined);
			if (!resolvedVideoMetadata?.ok) {
				const objectUrl = `${env.AWS_ENDPOINT as string}/${headerValues.bucketKey}`;
				resolvedVideoMetadata = await videoMetadata
					.extractFromUrl({
						url: objectUrl,
						contentType,
						imageName: headerValues.imageName,
						requestId,
					})
					.catch(() => undefined);
			}
			waitUntil(
				Promise.resolve(resolvedVideoMetadata)
					.then((result) => {
						if (!result) return;
						if (result.ok) {
							extractedMetadata = {
								parser: result.parser,
								bytesRead: result.bytesRead,
								imageName: result.imageName,
								contentType: result.contentType,
								tags: result.tags,
							};
							console.log("[VideoMetadataService] extracted metadata", {
								requestId,
								...extractedMetadata,
							});
							return;
						}
						console.log("[VideoMetadataService] failed metadata extraction", {
							requestId,
							parser: result.parser,
							bytesRead: result.bytesRead,
							imageName: result.imageName,
							contentType: result.contentType,
							error: result.error,
						});
					})
					.catch(() => undefined),
			);
			const metadataResult = resolvedVideoMetadata;
			if (metadataResult?.ok) {
				extractedMetadata = {
					parser: metadataResult.parser,
					bytesRead: metadataResult.bytesRead,
					imageName: metadataResult.imageName,
					contentType: metadataResult.contentType,
					tags: metadataResult.tags,
				};
			}
		}
	} catch (e) {
		console.error("[UploadRoutes] handleUpload error", { error: e });
		const isSizeError = isFileSizeExceededError(e);
		if (isSizeError && headerValues.isCallback === "1") {
			jiraya.scheduleDeleteImage(headerValues);
		}
		if (isSizeError) {
			throw new AppError("PAYLOAD_TOO_LARGE", {
				message: (e as { message?: string })?.message ?? "Payload too large",
				details: { code: "FILE_SIZE_EXCEEDED" },
			});
		}
		throw new AppError("UPSTREAM_B2_FAILED", { details: { error: String(e) } });
	}

	if (res.status >= 400) {
		console.error("[UploadRoutes] handleUpload error", { error: res.status });
		if (headerValues.isCallback === "1") {
			jiraya.scheduleDeleteImage(headerValues);
		}
		throw new AppError("UPSTREAM_B2_FAILED", { details: { status: res.status } });
	}

	const b2Id = res.headers.get("x-amz-version-id") ?? headerValues.uploadId ?? null;
	if (res.status === 200 && headerValues.isCallback === "1" && b2Id) {
		jiraya.schedulePostImageProcess(headerValues, b2Id, foUploadId, extractedMetadata, replace);
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

