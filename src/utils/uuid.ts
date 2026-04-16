/**
 * Generate UUID v3-like string from a string using SHA-256 hash.
 * Mirrors the previous worker logic (SHA-256 used for Workers compatibility).
 */
export async function generateUUIDv3Like(
	name: string,
	namespace = "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
): Promise<string> {
	const namespaceHex = namespace.replace(/-/g, "");
	const namespaceBytes = new Uint8Array(namespaceHex.match(/.{2}/g)!.map((h) => Number.parseInt(h, 16)));
	const nameBytes = new TextEncoder().encode(name);

	const combined = new Uint8Array(namespaceBytes.length + nameBytes.length);
	combined.set(namespaceBytes);
	combined.set(nameBytes, namespaceBytes.length);

	const hashBuffer = await crypto.subtle.digest("SHA-256", combined);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

	const y =
		((Number.parseInt(hash.substring(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0") +
		hash.substring(18, 20);

	const uuid =
		hash.substring(0, 8) +
		"-" +
		hash.substring(8, 12) +
		"-3" +
		hash.substring(13, 16) +
		"-" +
		y +
		"-" +
		hash.substring(20, 32);

	return uuid;
}

