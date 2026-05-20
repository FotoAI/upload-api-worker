import { AppError } from "../errors/app-error";

const IMAGE_CONTENT_TYPE_PREFIX = "image/";
const VIDEO_CONTENT_TYPE_PREFIX = "video/";

export function requireImageOrVideoContentType(contentType?: string): string {
	if (!contentType) {
		throw new AppError("MISSING_HEADER", { details: { header: "X-Bz-Content-Type" } });
	}

	const normalized = contentType.toLowerCase().trim();
	if (
		!normalized.startsWith(IMAGE_CONTENT_TYPE_PREFIX) &&
		!normalized.startsWith(VIDEO_CONTENT_TYPE_PREFIX)
	) {
		throw new AppError("INVALID_CONTENT_TYPE", {
			message: "Invalid content type. Only image and video uploads are supported.",
		});
	}

	return normalized;
}
