export async function retryWithExponentialBackoff<T>(
	fn: () => Promise<T>,
	opts?: {
		maxAttempts?: number;
		baseDelayMs?: number;
		shouldRetry?: (result: T) => Promise<boolean> | boolean;
	},
): Promise<T> {
	const maxAttempts = opts?.maxAttempts ?? 5;
	const baseDelayMs = opts?.baseDelayMs ?? 500;
	const shouldRetry = opts?.shouldRetry;

	const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

	let attempt = 0;
	while (attempt < maxAttempts) {
		try {
			const result = await fn();
			if (shouldRetry && (await shouldRetry(result))) {
				throw new Error("Retry condition met");
			}
			return result;
		} catch (e) {
			attempt += 1;
			if (attempt >= maxAttempts) throw e;
			const delay = baseDelayMs * Math.pow(2, attempt - 1);
			await sleep(delay);
		}
	}
	// unreachable
	throw new Error("retryWithExponentialBackoff exhausted");
}

