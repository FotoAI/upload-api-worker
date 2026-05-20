import { ERROR_CODES } from "./error-codes";
import { AppError, isAppError } from "./app-error";

export type ErrorResponse = {
	ok: false;
	code: string;
	message: string;
	details?: Record<string, unknown>;
};

export function toErrorResponse(err: unknown): { status: number; body: ErrorResponse } {
	if (isAppError(err)) {
		return {
			status: err.status,
			body: {
				ok: false,
				code: err.code,
				message: err.message,
				details: err.details,
			},
		};
	}

	if (err instanceof SyntaxError) {
		const meta = ERROR_CODES.INVALID_JSON;
		return {
			status: meta.httpStatus,
			body: { ok: false, code: "INVALID_JSON", message: meta.publicMessage },
		};
	}

	const meta = ERROR_CODES.INTERNAL_ERROR;
	return {
		status: meta.httpStatus,
		body: { ok: false, code: "INTERNAL_ERROR", message: meta.publicMessage },
	};
}

export function notFoundHandler(): never {
	throw new AppError("NOT_FOUND");
}

export function errorHandler(err: unknown): Response {
	const { status, body } = toErrorResponse(err);
	return Response.json(body, { status });
}
