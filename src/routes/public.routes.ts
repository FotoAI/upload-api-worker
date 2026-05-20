import { B2Service } from "../services/b2.service";
import { parsePublicFaceHeaders } from "../http/headers";
import { AppError } from "../errors/app-error";

const b2 = new B2Service();

export async function handlePublicFaceRoute(request: Request): Promise<Response> {
	const h = parsePublicFaceHeaders(request.headers);
	const uuid = crypto.randomUUID();
	const bucketKey = `events/${h.eventId}/pic_request/raw/${uuid}`;

	const body = request.body ?? new ReadableStream<Uint8Array>();
	const upstreamRes = await b2.upload(body, bucketKey, h.contentType, h.sha1);

	if (upstreamRes.status === 200) {
		return Response.json(
			{
				ok: true,
				message: "Image Upload Successfully",
				data: { uuid },
			},
			{ status: 200 },
		);
	}

	throw new AppError("UPSTREAM_B2_FAILED", { details: { status: upstreamRes.status } });
}

