import { AppError } from "../errors/app-error";
import { AuthService } from "../services/auth.service";

const authService = new AuthService();

export async function authMiddleware(request: Request) {
	const eventId = request.headers.get("FO-Event-Id");
	if (!eventId) throw new AppError("MISSING_HEADER", { details: { header: "FO-Event-Id" } });

	const rawGuest = request.headers.get("FO-Is-Guest-Upload");
	const isGuestUpload = rawGuest != null && rawGuest !== "" ? ["true", "1"].includes(rawGuest.toLowerCase()) : false;

	const result = await authService.checkAuth({
		authorizationHeader: request.headers.get("Authorization") ?? undefined,
		eventId,
		isGuestUpload,
	});

	if (!result.ok) {
		throw new AppError("UNAUTHORIZED", { details: { error: result.error ?? "Unauthorized" } });
	}
}
