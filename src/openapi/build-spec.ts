import { OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { registry, registerRoutes } from "./registry";

let cached: unknown | null = null;

export function buildOpenApiSpec(serverUrl: string) {
	if (cached) return cached;

	registerRoutes();

	const generator = new OpenApiGeneratorV3(registry.definitions);
	const doc = generator.generateDocument({
		openapi: "3.0.3",
		info: {
			title: "FotoOwl Upload API (v3)",
			version: "3.0.0",
			description:
				"Express-on-Workers implementation of FotoOwl upload APIs: single-object and multipart uploads, plus public face upload.",
		},
		servers: [{ url: serverUrl || "/", description: "This worker" }],
		tags: [
			{ name: "Upload", description: "Single object upload" },
			{ name: "Multipart", description: "Multipart upload flow" },
			{ name: "Public", description: "Public/no-auth routes" },
			{ name: "System", description: "Health and system endpoints" },
		],
	});

	cached = doc;
	return doc;
}

