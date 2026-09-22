import { B2Service } from "../services/b2.service";
import { parsePublicFaceHeaders } from "../http/headers";
import { AppError } from "../errors/app-error";
import { jsonOkResponse } from "../http/responses";

const b2 = new B2Service();

export async function handlePublicFaceRoute(request: Request): Promise<Response> {
	const h = parsePublicFaceHeaders(request.headers);
	const uuid = crypto.randomUUID();
	const bucketKey = `events/${h.eventId}/pic_request/raw/${uuid}`;

	const body = request.body ?? new ReadableStream<Uint8Array>();
	let upstreamRes: Response;
	try {
		upstreamRes = await b2.upload(body, bucketKey, h.contentType, h.sha1);
	} catch (e) {
		throw new AppError("UPSTREAM_B2_FAILED", { details: { error: String(e) } });
	}

	if (upstreamRes.status === 200) {
		return jsonOkResponse("Image Upload Successfully", { uuid });
	}

	throw new AppError("UPSTREAM_B2_FAILED", { details: { status: upstreamRes.status } });
}

