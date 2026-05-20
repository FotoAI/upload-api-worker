import * as ExifReader from "exifreader";
import { DOMParser, onErrorStopParsing } from "@xmldom/xmldom";

const MAX_BUFFERED_BYTES = 512 * 1024;
const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 32;
const MAX_STRING_LENGTH = 1024;
const MAX_OBJECT_KEYS = 100;

export type ExtractImageMetadataInput = {
	stream: ReadableStream<Uint8Array>;
	contentType?: string;
	imageName?: string;
	requestId?: string;
};

export type ExtractImageMetadataResult = {
	ok: true;
	parser: "exifreader";
	bytesRead: number;
	truncated: boolean;
	imageName?: string;
	contentType?: string;
	tags: Record<string, unknown>;
} | {
	ok: false;
	parser: "exifreader";
	bytesRead: number;
	truncated: boolean;
	imageName?: string;
	contentType?: string;
	error: string;
};

function appendChunk(left: Uint8Array<ArrayBufferLike>, right: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBufferLike> {
	const merged = new Uint8Array(left.length + right.length);
	merged.set(left);
	merged.set(right, left.length);
	return merged;
}

function clampString(input: string): string {
	if (input.length <= MAX_STRING_LENGTH) return input;
	return `${input.slice(0, MAX_STRING_LENGTH)}...`;
}

function sanitizeValue(value: unknown, depth = 0): unknown {
	if (depth > MAX_DEPTH) return "[MaxDepthExceeded]";

	if (value instanceof Uint8Array) {
		return {
			type: "Uint8Array",
			length: value.length,
			previewHex: Array.from(value.slice(0, 32))
				.map((v) => v.toString(16).padStart(2, "0"))
				.join(""),
		};
	}

	if (value instanceof ArrayBuffer) {
		const bytes = new Uint8Array(value);
		return {
			type: "ArrayBuffer",
			length: bytes.length,
			previewHex: Array.from(bytes.slice(0, 32))
				.map((v) => v.toString(16).padStart(2, "0"))
				.join(""),
		};
	}

	if (Array.isArray(value)) {
		const sliced = value.slice(0, MAX_ARRAY_ITEMS).map((v) => sanitizeValue(v, depth + 1));
		if (value.length > MAX_ARRAY_ITEMS) sliced.push(`[+${value.length - MAX_ARRAY_ITEMS} more items]`);
		return sliced;
	}

	if (typeof value === "string") return clampString(value);
	if (value == null) return value;

	if (typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>);
		const limitedEntries = entries.slice(0, MAX_OBJECT_KEYS);
		const out: Record<string, unknown> = {};
		for (const [key, val] of limitedEntries) {
			if (key === "Thumbnail") continue;
			out[key] = sanitizeValue(val, depth + 1);
		}
		if (entries.length > MAX_OBJECT_KEYS) {
			out.__truncatedKeys = entries.length - MAX_OBJECT_KEYS;
		}
		return out;
	}

	return value;
}

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

export class ImageMetadataService {
	shouldExtractForContentType(contentType?: string): boolean {
		return (contentType ?? "").toLowerCase().startsWith("image/");
	}

	async extractFromStream(input: ExtractImageMetadataInput): Promise<ExtractImageMetadataResult> {
		const { stream, contentType, imageName } = input;
		const reader = stream.getReader();
		let buffered: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
		let bytesRead = 0;
		let truncated = false;

		try {
			while (bytesRead < MAX_BUFFERED_BYTES) {
				const { done, value } = await reader.read();
				if (done) break;
				if (!value || value.length === 0) continue;

				const remaining = MAX_BUFFERED_BYTES - bytesRead;
				const chunk = value.length > remaining ? value.slice(0, remaining) : value;
				buffered = appendChunk(buffered, chunk);
				bytesRead += chunk.length;

				if (chunk.length < value.length || bytesRead >= MAX_BUFFERED_BYTES) {
					truncated = true;
					break;
				}
			}
		} finally {
			await reader.cancel().catch(() => undefined);
		}

		try {
			const exifInput = buffered.buffer.slice(buffered.byteOffset, buffered.byteOffset + buffered.byteLength);
			const tags = (await ExifReader.load(exifInput, {
				async: true,
				expanded: false,
				domParser: new DOMParser({ onError: onErrorStopParsing }),
				excludeTags: { thumbnail: true },
			})) as Record<string, unknown>;

			return {
				ok: true,
				parser: "exifreader",
				bytesRead,
				truncated,
				imageName,
				contentType,
				tags: sanitizeValue(tags) as Record<string, unknown>,
			};
		} catch (error) {
			return {
				ok: false,
				parser: "exifreader",
				bytesRead,
				truncated,
				imageName,
				contentType,
				error: toErrorMessage(error),
			};
		}
	}
}
