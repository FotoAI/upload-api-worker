import { env } from "cloudflare:workers";
import { AppError } from "../errors/app-error";
import { generateUUIDv3Like } from "../utils/uuid";

export type AuthResult = { ok: true;[k: string]: unknown } | { ok: false; error?: string };

export class AuthService {
	private readonly endpoint: string;

	constructor() {
		this.endpoint = env.API_HOST as string;
	}

	async checkAuth(opts: {
		authorizationHeader: string | undefined;
		eventId: string;
		isGuestUpload: boolean;
	}): Promise<AuthResult> {
		return { ok: true }; // TODO: Remove this before merging
		const authHeader = opts.authorizationHeader;
		if (!authHeader) return { ok: false, error: "Missing Authorization header" };

		const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
		const cacheKey = await generateUUIDv3Like(
			`${bearerToken}:${opts.eventId || ""}:${opts.isGuestUpload ? "1" : "0"}`,
		);

		const cache = (globalThis as unknown as { caches?: { default: Cache } }).caches?.default;
		const cacheUrl = `https://auth-cache/${cacheKey}`;
		const cacheRequest = new Request(cacheUrl);

		if (cache) {
			try {
				const cachedResponse = await cache.match(cacheRequest);
				if (cachedResponse) {
					return (await cachedResponse.json()) as AuthResult;
				}
			} catch (e) {
				console.warn("Auth cache match failed", { eventId: opts.eventId, isGuestUpload: opts.isGuestUpload, error: String(e) });
			}
		}

		const endpointPath = opts.isGuestUpload ? "/guest-user/event-storage-check" : "/admin/event-storage-check";
		const authUrl = new URL(`${this.endpoint}${endpointPath}`);
		authUrl.searchParams.set("event_id", opts.eventId);
		if (opts.isGuestUpload) authUrl.searchParams.set("guest_upload", "true");

		let response: Response;
		try {
			response = await fetch(authUrl.toString(), { method: "GET", headers: { Authorization: authHeader } });
		} catch (e) {
			throw new AppError("UPSTREAM_AUTH_FAILED", { details: { error: String(e) } });
		}

		const data = (await response.json()) as AuthResult;
		if (data.ok === true && cache) {
			const cacheResponse = new Response(JSON.stringify(data), {
				headers: {
					"Content-Type": "application/json",
					"Cache-Control": "max-age=300",
				},
			});
			try {
				await cache.put(cacheRequest, cacheResponse);
			} catch (e) {
				console.warn("Auth cache put failed", { eventId: opts.eventId, isGuestUpload: opts.isGuestUpload, error: String(e) });
			}
		}
		return data;
	}
}

