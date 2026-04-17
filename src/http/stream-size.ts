import type { Readable } from "node:stream";
import { AppError } from "../errors/app-error";

export class FileSizeExceededError extends Error {
	public readonly actualSize: number;
	public readonly maxSize: number;
	public readonly code = "PAYLOAD_TOO_LARGE" as const;

	constructor(actualSize: number, maxSize: number) {
		const actualSizeMB = (actualSize / (1024 * 1024)).toFixed(2);
		const maxSizeMB = (maxSize / (1024 * 1024)).toFixed(2);
		super(
			`File size ${actualSize} bytes (${actualSizeMB} MB) exceeds maximum allowed size of ${maxSize} bytes (${maxSizeMB} MB)`,
		);
		this.name = "FileSizeExceededError";
		this.actualSize = actualSize;
		this.maxSize = maxSize;
	}
}

export function validateContentLengthHeader(headers: { get(name: string): string | null }, maxSize: number) {
	const contentLength = headers.get("content-length");
	if (!contentLength) return;
	const size = Number.parseInt(contentLength, 10);
	if (!Number.isNaN(size) && size > maxSize) {
		throw new FileSizeExceededError(size, maxSize);
	}
}

/** Read a Node Readable (e.g. Express req) into memory with a hard cap. Prefer this over Readable.toWeb + fetch(body) in Workers Node compat to avoid post-response stream reader errors. */
export async function readNodeStreamToUint8ArrayWithLimit(stream: Readable, maxBytes: number): Promise<Uint8Array> {
	const chunks: Buffer[] = [];
	let total = 0;

	for await (const chunk of stream) {
		const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		total += buf.length;
		if (total > maxBytes) {
			throw new FileSizeExceededError(total, maxBytes);
		}
		chunks.push(buf);
	}

	if (chunks.length === 0) return new Uint8Array();
	const out = Buffer.concat(chunks);
	return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

export function isFileSizeExceededError(error: unknown): error is FileSizeExceededError {
	return (
		error instanceof FileSizeExceededError ||
		(typeof error === "object" &&
			error !== null &&
			(error as { name?: string }).name === "FileSizeExceededError") ||
		(typeof error === "object" &&
			error !== null &&
			typeof (error as { message?: string }).message === "string" &&
			(error as { message: string }).message.includes("exceeds maximum allowed size"))
	);
}

/**
 * Enforces a max size while streaming a Web ReadableStream.
 * Returns a new stream + an error promise that rejects if max size exceeded.
 */
export function enforceMaxBodySize(stream: ReadableStream<Uint8Array>, maxSize: number): {
	stream: ReadableStream<Uint8Array>;
	errorPromise: Promise<never>;
} {
	if (!stream || typeof (stream as ReadableStream).getReader !== "function") {
		throw new AppError("INTERNAL_ERROR", { details: { reason: "Invalid stream" } });
	}

	let totalSize = 0;
	const reader = stream.getReader();
	let cancelled = false;
	let rejectFn: ((e: unknown) => void) | null = null;
	const errorPromise = new Promise<never>((_resolve, reject) => {
		rejectFn = reject;
	});

	const validatedStream = new ReadableStream<Uint8Array>({
		async start(controller) {
			try {
				while (true) {
					if (cancelled) break;
					const { done, value } = await reader.read();
					if (done) {
						controller.close();
						break;
					}
					if (!value) continue;

					totalSize += value.byteLength;
					if (totalSize > maxSize) {
						cancelled = true;
						const err = new FileSizeExceededError(totalSize, maxSize);
						try {
							await reader.cancel(err);
						} catch {
							// ignore
						}
						rejectFn?.(err);
						controller.error(err);
						return;
					}
					controller.enqueue(value);
				}
			} catch (e) {
				if (!cancelled) {
					cancelled = true;
					rejectFn?.(e);
					controller.error(e);
				}
			} finally {
				try {
					if (!cancelled) await reader.cancel();
				} catch {
					// ignore
				}
			}
		},
		cancel(reason) {
			if (cancelled) return;
			cancelled = true;
			reader.cancel(reason).catch(() => undefined);
		},
	});

	return { stream: validatedStream, errorPromise };
}

