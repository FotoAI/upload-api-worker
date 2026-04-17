import { Readable } from "node:stream";

export function nodeReadableToWebStream(readable: Readable): ReadableStream<Uint8Array> {
	// Node 18+ static API; instance toWeb() takes optional strategy/options only — do not pass the readable as "options".
	return Readable.toWeb(readable) as unknown as ReadableStream<Uint8Array>;
}

