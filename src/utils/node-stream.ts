import { Readable } from "node:stream";

export function nodeReadableToWebStream(readable: Readable): ReadableStream<Uint8Array> {
	// Node 18+ provides Readable.toWeb; Workers node compat exposes node:stream.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const anyReadable = readable as any;
	if (typeof anyReadable.toWeb === "function") {
		return anyReadable.toWeb(readable) as ReadableStream<Uint8Array>;
	}
	// @ts-expect-error - Readable.toWeb exists at runtime
	return Readable.toWeb(readable) as ReadableStream<Uint8Array>;
}

