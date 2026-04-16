import { httpServerHandler } from "cloudflare:node";
import express from "express";
import { corsMiddleware } from "./middleware/cors.middleware";
import { authMiddleware } from "./middleware/auth.middleware";
import { uploadRouter } from "./routes/upload.routes";
import { multipartRouter } from "./routes/multipart.routes";
import { publicRouter } from "./routes/public.routes";
import { docsRouter } from "./routes/docs.routes";
import { errorHandler, notFoundHandler } from "./errors/error-handler";

const app = express();

app.disable("x-powered-by");

// CORS + preflight for all routes
app.use(corsMiddleware);

// Health
app.get("/upload-v3/health", (_req, res) => {
	res.status(200).json({ ok: true, message: "ok" });
});

// Docs (Basic auth inside router)
app.use(docsRouter);

// Public routes
app.use(publicRouter);

// Protected routes: auth applies only to selected paths
const protectedRouter = express.Router();
protectedRouter.use((req, res, next) => {
	const p = req.path;
	const isProtected =
		p === "/upload-worker-s3" ||
		p === "/upload-v3/upload" ||
		p === "/upload-v3/start-multipart" ||
		p === "/upload-v3/upload-part" ||
		p === "/upload-v3/complete-multipart" ||
		p === "/upload-v3/abort-multipart";
	if (!isProtected) return next();
	return authMiddleware(req, res, next);
});
protectedRouter.use(uploadRouter);
protectedRouter.use(multipartRouter);
app.use(protectedRouter);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(3000);
export default httpServerHandler({ port: 3000 });