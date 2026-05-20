import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
	SELF,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index";

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe("upload-api-worker", () => {
	it("health check (unit style)", async () => {
		const request = new IncomingRequest("http://example.com/upload-v3/health");
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		const body = (await response.json()) as { ok: boolean; message: string };
		expect(response.status).toBe(200);
		expect(body.ok).toBe(true);
		expect(body.message).toBe("ok");
	});

	it("health check (integration style)", async () => {
		const response = await SELF.fetch("https://example.com/upload-v3/health");
		const body = (await response.json()) as { ok: boolean; message: string };
		expect(response.status).toBe(200);
		expect(body.ok).toBe(true);
	});
});
