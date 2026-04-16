import { Router } from "express";
import type { Request } from "express";
import { B2Service } from "../services/b2.service";
import { JirayaService } from "../services/jiraya.service";
import { parseUploadHeadersFromExpress } from "../http/headers";
import { FileSizeExceededError, isFileSizeExceededError, validateContentLengthHeader } from "../http/stream-size";
import { AppError } from "../errors/app-error";
import { nodeReadableToWebStream } from "../utils/node-stream";

const MAX_SINGLE_UPLOAD_BYTES = 1024 * 1024 * 30; // 30MB

const b2 = new B2Service();
const jiraya = new JirayaService();

function requestHeadersToFetchHeaders(req: Request): Headers {
	const h = new Headers();
	for (const [k, v] of Object.entries(req.headers)) {
		if (v == null) continue;
		if (Array.isArray(v)) {
			for (const vv of v) h.append(k, vv);
		} else {
			h.set(k, v);
		}
	}
	return h;
}

export const uploadRouter = Router();

async function readStreamToUint8ArrayWithLimit(
	stream: ReadableStream<Uint8Array>,
	maxBytes: number,
): Promise<Uint8Array> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value || value.byteLength === 0) continue;

			total += value.byteLength;
			if (total > maxBytes) {
				throw new FileSizeExceededError(total, maxBytes);
			}
			chunks.push(value);
		}
	} finally {
		try {
			await reader.cancel();
		} catch {
			// ignore
		}
	}

	if (chunks.length === 0) return new Uint8Array();
	if (chunks.length === 1) return chunks[0];

	const out = new Uint8Array(total);
	let offset = 0;
	for (const c of chunks) {
		out.set(c, offset);
		offset += c.byteLength;
	}
	return out;
}

async function handleUpload(req: Request) {
	const headerValues = parseUploadHeadersFromExpress(req);

	// Early validation using Content-Length if present
	const fetchHeaders = requestHeadersToFetchHeaders(req);
	if (!headerValues.contentType) {
		throw new AppError("MISSING_HEADER", { details: { header: "X-Bz-Content-Type" } });
	}
	try {
		validateContentLengthHeader(fetchHeaders, MAX_SINGLE_UPLOAD_BYTES);
	} catch (e) {
		if (isFileSizeExceededError(e)) {
			throw new AppError("PAYLOAD_TOO_LARGE", { message: e.message, details: { code: "FILE_SIZE_EXCEEDED" } });
		}
	}

	let res: Response;
	try {
		const nodeStream = req as unknown as import("node:stream").Readable;
		const webStream = nodeReadableToWebStream(nodeStream);

		// Buffering (max 30MB) ensures the upstream PUT has a deterministic Content-Length.
		const bodyBytes = await readStreamToUint8ArrayWithLimit(webStream, MAX_SINGLE_UPLOAD_BYTES);

		res = await b2.upload(bodyBytes, headerValues.bucketKey, headerValues.contentType, headerValues.sha1);
	} catch (e) {
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
		if (headerValues.isCallback === "1") {
			jiraya.scheduleDeleteImage(headerValues);
		}
		throw new AppError("UPSTREAM_B2_FAILED", { details: { status: res.status } });
	}

	const b2Id = res.headers.get("x-amz-version-id") ?? headerValues.uploadId ?? null;
	if (res.status === 200 && headerValues.isCallback === "1" && b2Id) {
		jiraya.schedulePostImageProcess(headerValues, b2Id);
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
			partNum: headerValues.partNumber,
		},
	};
}

uploadRouter.post("/upload-v3/upload", async (req, res, next) => {
	try {
		const body = await handleUpload(req);
		res.status(200).json(body);
	} catch (e) {
		next(e);
	}
});

// legacy alias still supported for now
uploadRouter.post("/upload-worker-s3", async (req, res, next) => {
	try {
		const body = await handleUpload(req);
		res.status(200).json(body);
	} catch (e) {
		next(e);
	}
});

