import { jsonOkResponse } from "../http/responses";

export function handleVersionRoute(env: Env): Response {
	return jsonOkResponse("ok", {
		version: env.APP_VERSION ?? null,
		gitSha: env.GIT_SHA ?? null,
		environment: env.ENV,
		sentryRelease: env.SENTRY_RELEASE ?? null,
	});
}
