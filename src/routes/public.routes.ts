import { Router } from "express";
import type { Request } from "express";
import { B2Service } from "../services/b2.service";
import { parsePublicFaceHeadersFromExpress } from "../http/headers";
import { AppError } from "../errors/app-error";
import { nodeReadableToWebStream } from "../utils/node-stream";

const b2 = new B2Service();

export const publicRouter = Router();

publicRouter.post("/upload-v3/face", async (req, res, next) => {
	try {
		const h = parsePublicFaceHeadersFromExpress(req);
		const uuid = crypto.randomUUID();
		const bucketKey = `events/${h.eventId}/pic_request/raw/${uuid}`;

		const nodeStream = req as unknown as import("node:stream").Readable;
		const webStream = nodeReadableToWebStream(nodeStream);
		const upstreamRes = await b2.upload(webStream, bucketKey, h.contentType, h.sha1);

		if (upstreamRes.status === 200) {
			return res.status(200).json({
				ok: true,
				message: "Image Upload Successfully",
				data: { uuid },
			});
		}

		throw new AppError("UPSTREAM_B2_FAILED", { details: { status: upstreamRes.status } });
	} catch (e) {
		next(e);
	}
});

