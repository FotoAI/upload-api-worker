import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app-error";
import { AuthService } from "../services/auth.service";

const authService = new AuthService();

export async function authMiddleware(req: Request, _res: Response, next: NextFunction) {
	try {
		const eventId = req.header("FO-Event-Id");
		if (!eventId) throw new AppError("MISSING_HEADER", { details: { header: "FO-Event-Id" } });

		const rawGuest = req.header("FO-Is-Guest-Upload");
		const isGuestUpload = rawGuest != null && rawGuest !== "" ? ["true", "1"].includes(rawGuest.toLowerCase()) : false;

		const result = await authService.checkAuth({
			authorizationHeader: req.header("Authorization") ?? undefined,
			eventId,
			isGuestUpload,
		});

		if (!result.ok) {
			throw new AppError("UNAUTHORIZED", { details: { error: result.error ?? "Unauthorized" } });
		}

		return next();
	} catch (e) {
		return next(e);
	}
}

