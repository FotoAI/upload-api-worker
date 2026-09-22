import { z } from "zod";
import { AppError } from "../errors/app-error";

type HeaderSource = Headers | Record<string, unknown>;

function getHeader(headers: HeaderSource, name: string): string | undefined {
	if (headers instanceof Headers) {
		return headers.get(name) ?? undefined;
	}

	const v = headers[name.toLowerCase()];
	if (typeof v === "string") return v;
	if (Array.isArray(v)) {
		const first = v[0];
		return typeof first === "string" ? first : undefined;
	}
	return undefined;
}

function safeDecodeURIComponent(input: string): string {
	try {
		return decodeURIComponent(input);
	} catch {
		throw new AppError("INVALID_HEADER", { details: { header: "decoded", value: input } });
	}
}

export const GuestUploadHeaderSchema = z
	.string()
	.optional()
	.transform((raw) => {
		if (raw == null || raw === "") return false;
		const s = String(raw).trim().toLowerCase();
		return s === "true" || s === "1";
	});

export const GalleryHeaderSchema = z
	.string()
	.optional()
	.transform((raw) => {
		// Backwards-compatible default: missing/empty => true
		if (raw == null || raw === "") return true;
		const s = String(raw).trim().toLowerCase();
		if (s === "true" || s === "1") return true;
		if (s === "false" || s === "0") return false;
		return false;
	});

export const UploadHeadersSchema = z.object({
	eventId: z.string().min(1),
	authorization: z.string().min(1),

	// B2 / S3-compatible
	bucketKey: z.string().min(1),
	contentType: z.string().optional(),
	sha1: z.string().optional(),

	// Multipart
	uploadId: z.string().optional(),
	partNumber: z.string().optional(),
	contentLength: z.string().optional(),
	md5: z.string().optional(),

	// FotoOwl metadata
	collectionId: z.string().optional(),
	processId: z.string().optional(),
	imageHeight: z.string().optional(),
	imageWidth: z.string().optional(),
	imageSize: z.string().optional(),
	userId: z.string().optional(),
	imageName: z.string().optional(),
	foUploadId: z.string().optional(),
	imagePath: z.string().optional(),
	rawPath: z.string().optional(),
	isCallback: z.enum(["0", "1"]).optional(),
	isGallery: GalleryHeaderSchema,
	datetime: z.string().optional(),
	collectionIds: z.array(z.string()).optional(),
	isGuestUpload: GuestUploadHeaderSchema,
	deduplicateId: z.string().optional(),

	isCompression: z.boolean().optional(),
	compressionFactor: z.number().optional(),
});

export type UploadHeaders = z.infer<typeof UploadHeadersSchema>;

export function parseUploadHeaders(headers: HeaderSource): UploadHeaders {
	const foCollectionIds = getHeader(headers, "FO-Collection-Ids");
	let parsedCollectionIds: string[] = ["-1"];
	if (foCollectionIds) {
		try {
			const json = JSON.parse(foCollectionIds);
			if (Array.isArray(json)) {
				parsedCollectionIds = json.map((x) => String(x));
			} else {
				throw new Error("not_array");
			}
		} catch {
			throw new AppError("INVALID_HEADER", { details: { header: "FO-Collection-Ids" } });
		}
	}

	const rawImageName = getHeader(headers, "FO-Image-Name");
	const rawImagePath = getHeader(headers, "FO-Image-Path");
	const rawRawPath = getHeader(headers, "X-Bz-File-Name");

	const isCompression = getHeader(headers, "FO-Compression") === "true";
	const compressionQuality = getHeader(headers, "FO-Compression-Quality");
	const compressionFactor =
		compressionQuality != null && compressionQuality !== "" ? Number(compressionQuality) : undefined;

	const candidate = {
		eventId: getHeader(headers, "FO-Event-Id"),
		authorization: getHeader(headers, "Authorization"),
		bucketKey: getHeader(headers, "X-Bz-File-Name"),
		contentType: getHeader(headers, "X-Bz-Content-Type"),
		sha1: getHeader(headers, "X-Bz-Content-Sha1"),
		uploadId: getHeader(headers, "X-Bz-Upload-ID"),
		partNumber: getHeader(headers, "X-Bz-Part-Number"),
		contentLength: getHeader(headers, "X-Bz-Content-Length"),
		md5: getHeader(headers, "Content-MD5"),

		collectionId: getHeader(headers, "FO-Collection-Id"),
		processId: getHeader(headers, "FO-Process-Id"),
		imageHeight: getHeader(headers, "FO-Image-Height"),
		imageWidth: getHeader(headers, "FO-Image-Width"),
		imageSize: getHeader(headers, "FO-Image-Size"),
		userId: getHeader(headers, "FO-User-Id"),
		imageName: rawImageName ? safeDecodeURIComponent(rawImageName) : undefined,
		foUploadId: getHeader(headers, "FO-Upload-Id"),
		imagePath: rawImagePath ? safeDecodeURIComponent(rawImagePath) : undefined,
		rawPath: rawRawPath ? safeDecodeURIComponent(rawRawPath) : undefined,
		isCallback: getHeader(headers, "FO-Callback"),
		isGallery: getHeader(headers, "FO-Is-Gallery"),
		datetime: getHeader(headers, "FO-Date-Time"),
		collectionIds: parsedCollectionIds,
		isGuestUpload: getHeader(headers, "FO-Is-Guest-Upload"),
		deduplicateId: getHeader(headers, "FO-Deduplicate-Id"),

		isCompression,
		compressionFactor: Number.isFinite(compressionFactor) ? compressionFactor : undefined,
	};

	const parsed = UploadHeadersSchema.safeParse(candidate);
	if (!parsed.success) {
		throw new AppError("MISSING_HEADER", {
			details: { issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) },
		});
	}
	return parsed.data;
}

export const PublicFaceHeadersSchema = z.object({
	eventId: z.string().min(1),
	contentType: z.string().optional(),
	sha1: z.string().optional(),
});

export type PublicFaceHeaders = z.infer<typeof PublicFaceHeadersSchema>;

export function parsePublicFaceHeaders(headers: HeaderSource): PublicFaceHeaders {
	const candidate = {
		eventId: getHeader(headers, "FO-Event-Id"),
		contentType: getHeader(headers, "X-Bz-Content-Type"),
		sha1: getHeader(headers, "X-Bz-Content-Sha1"),
	};
	const parsed = PublicFaceHeadersSchema.safeParse(candidate);
	if (!parsed.success) {
		throw new AppError("MISSING_HEADER", {
			details: { issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) },
		});
	}
	return parsed.data;
}


