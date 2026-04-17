import express, { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { B2Service } from "../services/b2.service";
import { JirayaService } from "../services/jiraya.service";
import { ImageMetadataService } from "../services/image-metadata.service";
import { parseUploadHeadersFromExpress } from "../http/headers";
import {
	FileSizeExceededError,
	isFileSizeExceededError,
	readNodeStreamToUint8ArrayWithLimit,
	validateContentLengthHeader,
} from "../http/stream-size";
import { AppError } from "../errors/app-error";
import { CompleteMultipartBodySchema } from "../http/schemas";

/** One part cannot exceed full single-image cap; video parts allow larger chunks for 6GB / 1000 parts clients. */
const MAX_MULTIPART_PART_BYTES_IMAGE = 30 * 1024 * 1024;
const MAX_MULTIPART_PART_BYTES_VIDEO = 128 * 1024 * 1024;

function maxBytesForMultipartPart(contentType: string): number {
	return contentType.startsWith("video/") ? MAX_MULTIPART_PART_BYTES_VIDEO : MAX_MULTIPART_PART_BYTES_IMAGE;
}

const b2 = new B2Service();
const jiraya = new JirayaService();
const imageMetadata = new ImageMetadataService();

export const multipartRouter = Router();

function logMultipartMetadataSeam(headerValues: ReturnType<typeof parseUploadHeadersFromExpress>) {
	if (!imageMetadata.shouldExtractForContentType(headerValues.contentType)) return;
	console.log("[ImageMetadataService] multipart metadata extraction placeholder", {
		uploadId: headerValues.uploadId,
		bucketKey: headerValues.bucketKey,
		imageName: headerValues.imageName,
		contentType: headerValues.contentType,
	});
}

multipartRouter.get("/upload-v3/start-multipart", async (req, res, next) => {
	try {
		const h = parseUploadHeadersFromExpress(req);
		const response = await b2.startMultipart(h.bucketKey, h.contentType);
		res.status(200).json(response);
	} catch (e) {
		next(e);
	}
});

multipartRouter.post("/upload-v3/upload-part", async (req, res, next) => {
	try {
		const h = parseUploadHeadersFromExpress(req);
		if (!h.uploadId) throw new AppError("MISSING_HEADER", { details: { header: "X-Bz-Upload-ID" } });
		if (!h.partNumber) throw new AppError("MISSING_HEADER", { details: { header: "X-Bz-Part-Number" } });

		const partNumberInt = Number.parseInt(h.partNumber, 10);
		const contentType = h.contentType ?? "";
		if (contentType.startsWith("video/") && !Number.isNaN(partNumberInt) && partNumberInt > 1000) {
			throw new AppError("PART_LIMIT_EXCEEDED", {
				message: "Maximum part limit exceeded. MP4 uploads are limited to 1000 parts (6GB total).",
			});
		}
		if (contentType.startsWith("image/") && !Number.isNaN(partNumberInt) && partNumberInt > 6) {
			throw new AppError("PART_LIMIT_EXCEEDED", {
				message: "Maximum part limit exceeded. Image uploads are limited to 6 parts (30MB total).",
			});
		}

		const partMax = maxBytesForMultipartPart(contentType);
		const clHeaders = new Headers();
		const rawCl = req.get("content-length");
		if (rawCl) clHeaders.set("content-length", rawCl);
		try {
			validateContentLengthHeader(clHeaders, partMax);
		} catch (e) {
			if (e instanceof FileSizeExceededError) {
				throw new AppError("PAYLOAD_TOO_LARGE", { message: e.message, details: { code: "FILE_SIZE_EXCEEDED" } });
			}
			throw e;
		}

		const nodeStream = req as unknown as import("node:stream").Readable;
		const body = await readNodeStreamToUint8ArrayWithLimit(nodeStream, partMax);
		const response = await b2.uploadPart(body, h.bucketKey, h.uploadId, h.partNumber, {
			contentLength: h.contentLength,
			md5: h.md5,
			sha1: h.sha1,
		});
		res.status(200).json(response);
	} catch (e) {
		if (isFileSizeExceededError(e)) {
			next(
				new AppError("PAYLOAD_TOO_LARGE", {
					message: e.message,
					details: { code: "FILE_SIZE_EXCEEDED" },
				}),
			);
			return;
		}
		next(e);
	}
});

multipartRouter.post("/upload-v3/complete-multipart", express.json({ limit: "1mb" }), async (req, res, next) => {
	try {
		const h = parseUploadHeadersFromExpress(req);
		if (!h.uploadId) throw new AppError("MISSING_HEADER", { details: { header: "X-Bz-Upload-ID" } });

		const parsedBody = CompleteMultipartBodySchema.safeParse(req.body);
		if (!parsedBody.success) {
			throw new AppError("INVALID_JSON", { details: { issues: parsedBody.error.issues } });
		}

		const upstreamRes = await b2.completeMultipart(h.bucketKey, h.uploadId, parsedBody.data.parts);
		if (upstreamRes.status === 200 && h.isCallback === "1") {
			jiraya.schedulePostImageProcess(h, h.uploadId);
			// Reusable seam for future multipart metadata extraction pipeline.
			logMultipartMetadataSeam(h);
		}

		res.status(200).json({ ok: true, message: "Upload Complete" });
	} catch (e) {
		next(e);
	}
});

multipartRouter.post("/upload-v3/abort-multipart", async (req, res, next) => {
	try {
		const h = parseUploadHeadersFromExpress(req);
		if (!h.uploadId) throw new AppError("MISSING_HEADER", { details: { header: "X-Bz-Upload-ID" } });
		const response = await b2.abortMultipart(h.uploadId, h.bucketKey);
		res.status(200).json(response);
	} catch (e) {
		next(e);
	}
});

