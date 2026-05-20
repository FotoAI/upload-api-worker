export type ErrorCode =
	| "UNAUTHORIZED"
	| "MISSING_HEADER"
	| "INVALID_HEADER"
	| "INVALID_CONTENT_TYPE"
	| "INVALID_JSON"
	| "PAYLOAD_TOO_LARGE"
	| "PART_LIMIT_EXCEEDED"
	| "MULTIPART_UPLOAD_NOT_FOUND"
	| "UPSTREAM_AUTH_FAILED"
	| "UPSTREAM_B2_FAILED"
	| "UPSTREAM_JIRAYA_FAILED"
	| "NOT_FOUND"
	| "METHOD_NOT_ALLOWED"
	| "INTERNAL_ERROR";

export type ErrorCodeMeta = {
	httpStatus: number;
	publicMessage: string;
	meaning: string;
};

export const ERROR_CODES: Record<ErrorCode, ErrorCodeMeta> = {
	UNAUTHORIZED: {
		httpStatus: 401,
		publicMessage: "Unauthorized",
		meaning: "Request failed authentication/authorization checks.",
	},
	MISSING_HEADER: {
		httpStatus: 400,
		publicMessage: "Missing required header",
		meaning: "A required HTTP header for this endpoint was not provided.",
	},
	INVALID_HEADER: {
		httpStatus: 400,
		publicMessage: "Invalid header",
		meaning: "A provided HTTP header is malformed or cannot be parsed/decoded.",
	},
	INVALID_CONTENT_TYPE: {
		httpStatus: 400,
		publicMessage: "Invalid content type",
		meaning: "Content type is unsupported for this endpoint.",
	},
	INVALID_JSON: {
		httpStatus: 400,
		publicMessage: "Invalid JSON",
		meaning: "Request body JSON is invalid or does not match the expected schema.",
	},
	PAYLOAD_TOO_LARGE: {
		httpStatus: 413,
		publicMessage: "Payload too large",
		meaning: "Request body exceeded the configured size limit.",
	},
	PART_LIMIT_EXCEEDED: {
		httpStatus: 413,
		publicMessage: "Part limit exceeded",
		meaning: "Multipart upload part number exceeds the allowed maximum for the content type.",
	},
	MULTIPART_UPLOAD_NOT_FOUND: {
		httpStatus: 404,
		publicMessage: "Multipart upload session not found",
		meaning: "Multipart upload session was not started, has expired, or was already completed/aborted.",
	},
	UPSTREAM_AUTH_FAILED: {
		httpStatus: 502,
		publicMessage: "Auth service error",
		meaning: "Upstream auth check failed due to network/API error.",
	},
	UPSTREAM_B2_FAILED: {
		httpStatus: 502,
		publicMessage: "Storage upload failed",
		meaning: "Upstream S3-compatible storage returned an error.",
	},
	UPSTREAM_JIRAYA_FAILED: {
		httpStatus: 502,
		publicMessage: "Callback scheduling failed",
		meaning: "Upstream Jiraya callback call failed (process/delete).",
	},
	NOT_FOUND: {
		httpStatus: 404,
		publicMessage: "Not found",
		meaning: "Route does not exist.",
	},
	METHOD_NOT_ALLOWED: {
		httpStatus: 405,
		publicMessage: "Method not allowed",
		meaning: "HTTP method not allowed for this route.",
	},
	INTERNAL_ERROR: {
		httpStatus: 500,
		publicMessage: "Internal error",
		meaning: "Unexpected server error.",
	},
};

