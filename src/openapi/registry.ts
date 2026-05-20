import { extendZodWithOpenApi, OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import {
	CompleteMultipartBodySchema,
	ErrorResponseSchema,
	FaceUploadResponseSchema,
	OkResponseSchema,
	StartMultipartResponseSchema,
	UploadOkResponseSchema,
	UploadPartResponseSchema,
} from "../http/schemas";

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

export const BearerAuth = registry.registerComponent("securitySchemes", "BearerAuth", {
	type: "http",
	scheme: "bearer",
	bearerFormat: "JWT",
	description: "Bearer token validated against FotoOwl API event-storage-check.",
});

const headerParam = (name: string, schema: z.ZodTypeAny = z.string(), required = false, description?: string) =>
	schema.openapi({
		param: {
			name,
			in: "header",
			required,
			description,
		},
	});

// Common headers (not all are required on all routes, but we document the main set).
export const FOEventIdHeader = headerParam("FO-Event-Id", z.string(), true, "Event ID");
export const AuthorizationHeader = headerParam("Authorization", z.string(), true, "Bearer token");
export const XbzFileNameHeader = headerParam("X-Bz-File-Name", z.string(), true, "Object key/path in bucket");
export const XbzContentTypeHeader = headerParam("X-Bz-Content-Type", z.string(), false, "MIME type");
export const XbzContentSha1Header = headerParam("X-Bz-Content-Sha1", z.string(), false, "SHA1 of body");
export const XbzUploadIdHeader = headerParam("X-Bz-Upload-ID", z.string(), true, "Multipart upload id");
export const XbzPartNumberHeader = headerParam("X-Bz-Part-Number", z.string(), true, "1-based part number");
export const XbzContentLengthHeader = headerParam("X-Bz-Content-Length", z.string(), false, "Part size in bytes");
export const ContentMd5Header = headerParam("Content-MD5", z.string(), false, "MD5 of the part body");
export const FOCallbackHeader = headerParam("FO-Callback", z.enum(["0", "1"]), false, "If 1, schedules backend callback");
export const FOIsGuestUploadHeader = headerParam(
	"FO-Is-Guest-Upload",
	z.string(),
	false,
	"If true/1, uses guest-user event-storage-check",
);

export function registerRoutes() {
	registry.registerPath({
		method: "get",
		path: "/upload-v3/health",
		tags: ["System"],
		responses: {
			200: {
				description: "OK",
				content: { "application/json": { schema: OkResponseSchema } },
			},
		},
	});

	registry.registerPath({
		method: "post",
		path: "/upload-v3/upload",
		tags: ["Upload"],
		security: [{ [BearerAuth.name]: [] }],
		request: {
			headers: z.object({
				"FO-Event-Id": FOEventIdHeader,
				Authorization: AuthorizationHeader,
				"X-Bz-File-Name": XbzFileNameHeader,
				"X-Bz-Content-Type": XbzContentTypeHeader,
				"X-Bz-Content-Sha1": XbzContentSha1Header,
			}),
			body: {
				content: {
					"application/octet-stream": { schema: z.string().openapi({ format: "binary" }) },
				},
			},
		},
		responses: {
			200: {
				description: "Upload ok",
				content: { "application/json": { schema: UploadOkResponseSchema } },
			},
			400: { description: "Bad request", content: { "application/json": { schema: ErrorResponseSchema } } },
			401: { description: "Unauthorized", content: { "application/json": { schema: ErrorResponseSchema } } },
			413: { description: "Too large", content: { "application/json": { schema: ErrorResponseSchema } } },
			500: { description: "Error", content: { "application/json": { schema: ErrorResponseSchema } } },
		},
	});

	registry.registerPath({
		method: "post",
		path: "/upload-v3/start-multipart",
		tags: ["Multipart"],
		security: [{ [BearerAuth.name]: [] }],
		request: {
			headers: z.object({
				"FO-Event-Id": FOEventIdHeader,
				Authorization: AuthorizationHeader,
				"X-Bz-File-Name": XbzFileNameHeader,
				"X-Bz-Content-Type": XbzContentTypeHeader,
				"FO-Is-Guest-Upload": FOIsGuestUploadHeader,
			}),
		},
		responses: {
			200: { description: "Started", content: { "application/json": { schema: StartMultipartResponseSchema } } },
			400: { description: "Bad request", content: { "application/json": { schema: ErrorResponseSchema } } },
			401: { description: "Unauthorized", content: { "application/json": { schema: ErrorResponseSchema } } },
		},
	});

	registry.registerPath({
		method: "post",
		path: "/upload-v3/upload-part",
		tags: ["Multipart"],
		security: [{ [BearerAuth.name]: [] }],
		request: {
			headers: z.object({
				"FO-Event-Id": FOEventIdHeader,
				Authorization: AuthorizationHeader,
				"X-Bz-File-Name": XbzFileNameHeader,
				"X-Bz-Upload-ID": XbzUploadIdHeader,
				"X-Bz-Part-Number": XbzPartNumberHeader,
				"X-Bz-Content-Type": XbzContentTypeHeader,
				"Content-MD5": ContentMd5Header,
			}),
			body: {
				content: {
					"application/octet-stream": { schema: z.string().openapi({ format: "binary" }) },
				},
			},
		},
		responses: {
			200: { description: "Part uploaded", content: { "application/json": { schema: UploadPartResponseSchema } } },
			413: { description: "Part limit exceeded", content: { "application/json": { schema: ErrorResponseSchema } } },
		},
	});

	registry.registerPath({
		method: "post",
		path: "/upload-v3/complete-multipart",
		tags: ["Multipart"],
		security: [{ [BearerAuth.name]: [] }],
		request: {
			headers: z.object({
				"FO-Event-Id": FOEventIdHeader,
				Authorization: AuthorizationHeader,
				"X-Bz-File-Name": XbzFileNameHeader,
				"X-Bz-Upload-ID": XbzUploadIdHeader,
				"FO-Callback": FOCallbackHeader,
			}),
			body: { content: { "application/json": { schema: CompleteMultipartBodySchema } } },
		},
		responses: {
			200: { description: "Completed", content: { "application/json": { schema: OkResponseSchema } } },
		},
	});

	registry.registerPath({
		method: "post",
		path: "/upload-v3/abort-multipart",
		tags: ["Multipart"],
		security: [{ [BearerAuth.name]: [] }],
		request: {
			headers: z.object({
				"FO-Event-Id": FOEventIdHeader,
				Authorization: AuthorizationHeader,
				"X-Bz-File-Name": XbzFileNameHeader,
				"X-Bz-Upload-ID": XbzUploadIdHeader,
			}),
		},
		responses: {
			200: { description: "Aborted", content: { "application/json": { schema: OkResponseSchema } } },
		},
	});

	registry.registerPath({
		method: "post",
		path: "/upload-v3/face",
		tags: ["Public"],
		request: {
			headers: z.object({
				"FO-Event-Id": FOEventIdHeader,
				"X-Bz-Content-Type": XbzContentTypeHeader,
				"X-Bz-Content-Sha1": XbzContentSha1Header,
			}),
			body: { content: { "application/octet-stream": { schema: z.string().openapi({ format: "binary" }) } } },
		},
		responses: {
			200: { description: "Uploaded", content: { "application/json": { schema: FaceUploadResponseSchema } } },
		},
	});
}

