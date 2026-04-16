import { AwsClient } from "aws4fetch";
import { Builder, parseStringPromise } from "xml2js";
import { env } from "cloudflare:workers";
import { AppError } from "../errors/app-error";

type StartMultipartResult = {
	ok: true;
	data: { uploadId: string; bucket: string; key: string };
};

export class B2Service {
	private readonly aws: AwsClient;
	private readonly endpoint: string;

	constructor() {
		this.aws = new AwsClient({
			accessKeyId: env.AWS_ACCESS_KEY_ID as string,
			secretAccessKey: env.AWS_SECRET_ACCESS_KEY as string,
			region: env.AWS_DEFAULT_REGION as string,
		});
		this.endpoint = env.AWS_ENDPOINT as string;
	}

	async startMultipart(key: string, contentType?: string): Promise<StartMultipartResult> {
		const headers = new Headers();
		if (contentType) headers.append("Content-Type", contentType);

		const response = await this.aws.fetch(`${this.endpoint}/${key}?uploads`, {
			method: "POST",
			headers,
		});
		const body = await response.text();
		if (!response.ok) {
			throw new AppError("UPSTREAM_B2_FAILED", {
				details: { status: response.status, body: body.slice(0, 2000) },
			});
		}

		const result = await parseStringPromise(body);
		const r = result?.InitiateMultipartUploadResult;
		const { Bucket, Key, UploadId } = r ?? {};
		if (!Bucket?.[0] || !Key?.[0] || !UploadId?.[0]) {
			throw new AppError("UPSTREAM_B2_FAILED", { details: { reason: "Unexpected XML response" } });
		}

		return {
			ok: true,
			data: { uploadId: UploadId[0], bucket: Bucket[0], key: Key[0] },
		};
	}

	async abortMultipart(uploadId: string, key: string): Promise<{ ok: boolean; message: string }> {
		const response = await this.aws.fetch(`${this.endpoint}/${key}?uploadId=${uploadId}`, { method: "DELETE" });
		if (response.status === 204) return { ok: true, message: "Multipart upload abort Success" };
		return { ok: false, message: "Multipart upload abort Fail" };
	}

	async completeMultipart(
		key: string,
		uploadId: string,
		parts: Array<{ etag: string; partNumber: string; sha1?: string | null }>,
	): Promise<Response> {
		const builder = new Builder();
		const formatParts = parts.map((p) => ({
			ETag: p.etag,
			PartNumber: p.partNumber,
			ChecksumSHA1: p.sha1 ?? undefined,
		}));
		const xmlBody = builder.buildObject({
			CompleteMultipartUpload: {
				$: { xmlns: "http://s3.amazonaws.com/doc/2006-03-01/" },
				Part: formatParts,
			},
		});

		return this.aws.fetch(`${this.endpoint}/${key}?uploadId=${uploadId}`, { method: "POST", body: xmlBody });
	}

	async upload(body: BodyInit, key: string, contentType?: string, sha1?: string): Promise<Response> {
		const headers = new Headers();
		if (contentType) headers.append("Content-Type", contentType);
		if (sha1) headers.append("X-Bz-Content-Sha1", sha1);

		return this.aws.fetch(`${this.endpoint}/${key}`, {
			method: "PUT",
			body,
			headers,
		});
	}

	async uploadPart(
		body: BodyInit,
		key: string,
		uploadId: string,
		partNumber: string,
		opts: { contentLength?: string; md5?: string; sha1?: string },
	): Promise<{ etag: string | null; "x-amz-id-2": string | null; partNumber: string; sha1: string | null }> {
		const requestHeaders = new Headers();
		if (opts.contentLength) requestHeaders.append("Content-Length", opts.contentLength);
		if (opts.md5) requestHeaders.append("Content-MD5", opts.md5);

		const response = await this.aws.fetch(
			`${this.endpoint}/${key}?partNumber=${encodeURIComponent(partNumber)}&uploadId=${encodeURIComponent(uploadId)}`,
			{ method: "PUT", body, headers: requestHeaders },
		);

		return {
			etag: response.headers.get("ETag"),
			"x-amz-id-2": response.headers.get("x-amz-id-2"),
			partNumber,
			sha1: opts.sha1 ?? null,
		};
	}
}

