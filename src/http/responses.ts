export type OkResponse<T = undefined> = T extends undefined
	? { ok: true; message: string }
	: { ok: true; message: string; data: T };

export function buildOkBody<T>(message: string, data?: T): OkResponse<T> {
	if (data === undefined) {
		return { ok: true, message } as OkResponse<T>;
	}
	return { ok: true, message, data } as OkResponse<T>;
}

export function jsonOkResponse<T>(
	message: string,
	data?: T,
	opts?: { status?: number; headers?: HeadersInit },
): Response {
	return Response.json(buildOkBody(message, data), { status: opts?.status ?? 200, headers: opts?.headers });
}
