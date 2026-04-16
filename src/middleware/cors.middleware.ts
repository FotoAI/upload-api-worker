import type { NextFunction, Request, Response } from "express";

const DEFAULT_ALLOW_METHODS = "GET,POST,PUT,DELETE,OPTIONS";

export function corsMiddleware(req: Request, res: Response, next: NextFunction) {
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Access-Control-Allow-Methods", DEFAULT_ALLOW_METHODS);
	res.setHeader("Access-Control-Max-Age", "86400");

	const reqHeaders = req.header("Access-Control-Request-Headers");
	if (reqHeaders) {
		res.setHeader("Access-Control-Allow-Headers", reqHeaders);
	}

	if (req.method === "OPTIONS") {
		return res.status(204).end();
	}
	next();
}

