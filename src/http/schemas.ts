import { z } from "zod";

export const OkResponseSchema = z.object({
	ok: z.literal(true),
	message: z.string(),
});

export const ErrorResponseSchema = z.object({
	ok: z.literal(false),
	code: z.string(),
	message: z.string(),
	details: z.record(z.unknown()).optional(),
});

export const UploadOkResponseSchema = z.object({
	ok: z.literal(true),
	message: z.string(),
	data: z.object({
		name: z.string().optional(),
		id: z.string().optional(),
		height: z.string().optional(),
		width: z.string().optional(),
		sha: z.string().optional(),
		b2Id: z.string().optional(),
		partNum: z.string().optional(),
	}),
});

export const StartMultipartResponseSchema = z.object({
	ok: z.boolean(),
	data: z
		.object({
			uploadId: z.string(),
			bucket: z.string(),
			key: z.string(),
		})
		.optional(),
	message: z.string().optional(),
});

export const UploadPartResponseSchema = z.object({
	etag: z.string().nullable().optional(),
	"x-amz-id-2": z.string().nullable().optional(),
	partNumber: z.string(),
	sha1: z.string().nullable().optional(),
});

export const CompleteMultipartBodySchema = z.object({
	parts: z.array(
		z.object({
			etag: z.string(),
			partNumber: z.string(),
			sha1: z.string().nullable().optional(),
		}),
	),
});

export const FaceUploadResponseSchema = z.object({
	ok: z.boolean(),
	message: z.string(),
	data: z
		.object({
			uuid: z.string().uuid(),
		})
		.optional(),
});

export type UploadOkResponse = z.infer<typeof UploadOkResponseSchema>;

