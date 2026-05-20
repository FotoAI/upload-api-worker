import { ALL_FORMATS, Input, ReadableStreamSource, UrlSource } from "mediabunny";

type ExtractVideoMetadataInput = {
	url: string;
	contentType?: string;
	imageName?: string;
	requestId?: string;
};

export type ExtractVideoMetadataResult =
	| {
			ok: true;
			parser: "mediabunny";
			requestId?: string;
			bytesRead: number;
			imageName?: string;
			contentType?: string;
			tags: Record<string, unknown>;
	  }
	| {
			ok: false;
			parser: "mediabunny";
			requestId?: string;
			bytesRead: number;
			imageName?: string;
			contentType?: string;
			error: string;
	  };

const clampString = (value: string, max = 512): string => (value.length <= max ? value : `${value.slice(0, max)}...`);

const serializeTagValue = (value: unknown): unknown => {
	if (value instanceof Date) return value.toISOString();
	if (value instanceof Uint8Array) {
		return { type: "Uint8Array", length: value.length };
	}
	if (Array.isArray(value)) return value.map(serializeTagValue);
	if (value && typeof value === "object") {
		const asRecord = value as Record<string, unknown>;
		const out: Record<string, unknown> = {};
		for (const [key, nestedValue] of Object.entries(asRecord)) {
			if (key === "data" && nestedValue instanceof Uint8Array) {
				out[key] = { type: "Uint8Array", length: nestedValue.length };
				continue;
			}
			out[key] = serializeTagValue(nestedValue);
		}
		return out;
	}
	if (typeof value === "string") return clampString(value, 4096);
	return value;
};

const compactRecord = (record: Record<string, unknown>): Record<string, unknown> => {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(record)) {
		if (value === undefined || value === null) continue;
		if (Array.isArray(value) && value.length === 0) continue;
		out[key] = value;
	}
	return out;
};

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

export class VideoMetadataService {
	shouldExtractForContentType(contentType?: string): boolean {
		return (contentType ?? "").toLowerCase().startsWith("video/");
	}

	async extractFromStream(input: {
		stream: ReadableStream<Uint8Array>;
		contentType?: string;
		imageName?: string;
		requestId?: string;
	}): Promise<ExtractVideoMetadataResult> {
		const { stream, contentType, imageName, requestId } = input;
		const source = new ReadableStreamSource(stream);
		const mediaInput = new Input({
			source,
			formats: ALL_FORMATS,
		});

		try {
			const tags = await this.extractTags(mediaInput);
			return {
				ok: true,
				parser: "mediabunny",
				requestId,
				bytesRead: 0,
				imageName,
				contentType,
				tags,
			};
		} catch (error) {
			return {
				ok: false,
				parser: "mediabunny",
				requestId,
				bytesRead: 0,
				imageName,
				contentType,
				error: toErrorMessage(error),
			};
		}
	}

	async extractFromUrl(input: ExtractVideoMetadataInput): Promise<ExtractVideoMetadataResult> {
		const { url, contentType, imageName, requestId } = input;
		const source = new UrlSource(url);
		let bytesRead = 0;

		source.onread = (start: number, end: number) => {
			bytesRead += end - start;
		};

		const mediaInput = new Input({
			source,
			formats: ALL_FORMATS,
		});

		try {
			return {
				ok: true,
				parser: "mediabunny",
				requestId,
				bytesRead,
				imageName,
				contentType,
				tags: await this.extractTags(mediaInput),
			};
		} catch (error) {
			return {
				ok: false,
				parser: "mediabunny",
				requestId,
				bytesRead,
				imageName,
				contentType,
				error: toErrorMessage(error),
			};
		}
	}

	private async extractTags(mediaInput: any): Promise<Record<string, unknown>> {
		const [format, mimeType, startTimestamp, duration, tracks, metadataTags] = await Promise.all([
			mediaInput.getFormat(),
			mediaInput.getMimeType(),
			mediaInput.getFirstTimestamp(),
			mediaInput.computeDuration(),
			mediaInput.getTracks(),
			mediaInput.getMetadataTags(),
		]);

		const serializedTracks = await Promise.all(
			tracks.map(async (track: any) => {
				const base: Record<string, unknown> = {
					id: track.id,
					number: track.number,
					type: track.type,
					codec: track.codec ?? null,
					codecParameterString: await track.getCodecParameterString(),
					languageCode: track.languageCode,
					name: track.name,
					startTimestamp: await track.getFirstTimestamp(),
					duration: await track.computeDuration(),
				};

				if (track.isVideoTrack()) {
					base.video = {
						codedWidth: track.codedWidth,
						codedHeight: track.codedHeight,
						displayWidth: track.displayWidth,
						displayHeight: track.displayHeight,
						rotation: track.rotation,
						pixelAspectRatio: track.pixelAspectRatio,
						canBeTransparent: track.canBeTransparent(),
						hasHighDynamicRange: track.hasHighDynamicRange(),
						colorSpace: await track.getColorSpace(),
					};
				} else if (track.isAudioTrack()) {
					base.audio = {
						numberOfChannels: track.numberOfChannels,
						sampleRate: track.sampleRate,
					};
				}

				return compactRecord(base);
			}),
		);

		return {
			format: {
				name: format.name,
				mimeType: format.mimeType,
			},
			file: {
				mimeType,
				startTimestamp,
				duration,
			},
			tracks: serializedTracks,
			metadataTags: serializeTagValue(metadataTags),
		};
	}
}
