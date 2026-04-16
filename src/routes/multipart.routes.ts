import express, { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { B2Service } from "../services/b2.service";
import { JirayaService } from "../services/jiraya.service";
import { parseUploadHeadersFromExpress } from "../http/headers";
import { AppError } from "../errors/app-error";
import { nodeReadableToWebStream } from "../utils/node-stream";
import { CompleteMultipartBodySchema } from "../http/schemas";

const b2 = new B2Service();
const jiraya = new JirayaService();

export const multipartRouter = Router();

multipartRouter.post("/upload-v3/start-multipart", async (req, res, next) => {
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

		const nodeStream = req as unknown as import("node:stream").Readable;
		const webStream = nodeReadableToWebStream(nodeStream);

		const response = await b2.uploadPart(webStream, h.bucketKey, h.uploadId, h.partNumber, {
			contentLength: h.contentLength,
			md5: h.md5,
			sha1: h.sha1,
		});
		res.status(200).json(response);
	} catch (e) {
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

