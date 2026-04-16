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

const Header = (name: string, schema: z.ZodTypeAny, required = false, description?: string) =>
	z
		.object({ [name]: schema })
		.openapi({
			param: {
				name,
				in: "header",
				required,
				description,
			},
		});

// Common headers (not all are required on all routes, but we document the main set).
export const FOEventIdHeader = Header("FO-Event-Id", z.string(), true, "Event ID");
export const AuthorizationHeader = Header("Authorization", z.string(), true, "Bearer token");
export const XbzFileNameHeader = Header("X-Bz-File-Name", z.string(), true, "Object key/path in bucket");
export const XbzContentTypeHeader = Header("X-Bz-Content-Type", z.string(), false, "MIME type");
export const XbzContentSha1Header = Header("X-Bz-Content-Sha1", z.string(), false, "SHA1 of body");
export const XbzUploadIdHeader = Header("X-Bz-Upload-ID", z.string(), true, "Multipart upload id");
export const XbzPartNumberHeader = Header("X-Bz-Part-Number", z.string(), true, "1-based part number");
export const XbzContentLengthHeader = Header("X-Bz-Content-Length", z.string(), false, "Part size in bytes");
export const ContentMd5Header = Header("Content-MD5", z.string(), false, "MD5 of the part body");
export const FOCallbackHeader = Header("FO-Callback", z.enum(["0", "1"]), false, "If 1, schedules backend callback");
export const FOIsGuestUploadHeader = Header(
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
			headers: z.intersection(
				z.intersection(FOEventIdHeader, AuthorizationHeader),
				z.intersection(XbzFileNameHeader, z.intersection(XbzContentTypeHeader, XbzContentSha1Header)),
			),
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
			headers: z.intersection(
				z.intersection(FOEventIdHeader, AuthorizationHeader),
				z.intersection(XbzFileNameHeader, z.intersection(XbzContentTypeHeader, FOIsGuestUploadHeader)),
			),
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
			headers: z.intersection(
				z.intersection(FOEventIdHeader, AuthorizationHeader),
				z.intersection(
					XbzFileNameHeader,
					z.intersection(
						XbzUploadIdHeader,
						z.intersection(XbzPartNumberHeader, z.intersection(XbzContentTypeHeader, ContentMd5Header)),
					),
				),
			),
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
			headers: z.intersection(
				z.intersection(FOEventIdHeader, AuthorizationHeader),
				z.intersection(XbzFileNameHeader, z.intersection(XbzUploadIdHeader, FOCallbackHeader)),
			),
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
			headers: z.intersection(
				z.intersection(FOEventIdHeader, AuthorizationHeader),
				z.intersection(XbzFileNameHeader, XbzUploadIdHeader),
			),
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
			headers: z.intersection(FOEventIdHeader, z.intersection(XbzContentTypeHeader, XbzContentSha1Header)),
			body: { content: { "application/octet-stream": { schema: z.string().openapi({ format: "binary" }) } } },
		},
		responses: {
			200: { description: "Uploaded", content: { "application/json": { schema: FaceUploadResponseSchema } } },
		},
	});
}

