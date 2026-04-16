import { ERROR_CODES, type ErrorCode } from "./error-codes";

export type ErrorDetails = Record<string, unknown>;

export class AppError extends Error {
	public readonly code: ErrorCode;
	public readonly status: number;
	public readonly details?: ErrorDetails;

	constructor(code: ErrorCode, opts?: { message?: string; details?: ErrorDetails }) {
		const meta = ERROR_CODES[code];
		super(opts?.message ?? meta.publicMessage);
		this.name = "AppError";
		this.code = code;
		this.status = meta.httpStatus;
		this.details = opts?.details;
	}
}

export function isAppError(err: unknown): err is AppError {
	return typeof err === "object" && err !== null && (err as { name?: string }).name === "AppError";
}

