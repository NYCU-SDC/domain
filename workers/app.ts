import { createRequestHandler, RouterContextProvider } from "react-router";

import { workerRuntimeContext } from "../app/lib/runtime-context";

const requestHandler = createRequestHandler(() => import("virtual:react-router/server-build"), import.meta.env.MODE);

function randomBase64Url(byteLength: number): string {
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function applySecurityHeaders(response: Response, request: Request, env: Env, nonce: string, requestId: string): Response {
	const headers = new Headers(response.headers);
	const url = new URL(request.url);
	const production = env.ENVIRONMENT === "production";
	const localDevelopment = env.ENVIRONMENT === "local";
	const csp = [
		"default-src 'self'",
		`script-src 'self' 'nonce-${nonce}'`,
		localDevelopment ? "style-src 'self' 'unsafe-inline' https://font.emtech.cc" : "style-src 'self' https://font.emtech.cc",
		"img-src 'self' data: https://avatars.githubusercontent.com",
		"font-src 'self' https://font.emtech.cc",
		"connect-src 'self'",
		"object-src 'none'",
		"base-uri 'self'",
		"form-action 'self'",
		"frame-ancestors 'none'",
		production ? "upgrade-insecure-requests" : ""
	]
		.filter(Boolean)
		.join("; ");

	headers.set("Content-Security-Policy", csp);
	headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
	headers.set("Cross-Origin-Resource-Policy", "same-origin");
	headers.set("Permissions-Policy", "camera=(), geolocation=(), microphone=(), payment=(), usb=()");
	headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
	headers.set("X-Content-Type-Options", "nosniff");
	headers.set("X-Frame-Options", "DENY");
	headers.set("X-Request-ID", requestId);

	if (production) {
		// Do not force HSTS onto independently managed club subdomains.
		headers.set("Strict-Transport-Security", "max-age=31536000");
	}

	if (
		url.pathname.startsWith("/api/") ||
		url.pathname.startsWith("/auth/") ||
		url.pathname.startsWith("/dashboard") ||
		url.pathname.startsWith("/admin") ||
		url.pathname === "/apply" ||
		url.pathname === "/login" ||
		url.pathname === "/access-pending"
	) {
		headers.set("Cache-Control", "no-store");
		headers.set("Pragma", "no-cache");
	}

	return new Response(response.body, {
		headers,
		status: response.status,
		statusText: response.statusText
	});
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const startedAt = performance.now();
		const requestId = crypto.randomUUID();
		const cspNonce = randomBase64Url(18);
		const requestHeaders = new Headers(request.headers);
		requestHeaders.set("X-NYCU-Request-ID", requestId);
		requestHeaders.set("X-NYCU-CSP-Nonce", cspNonce);
		const trustedRequest = new Request(request, { headers: requestHeaders });
		const context = new RouterContextProvider();
		context.set(workerRuntimeContext, { cspNonce, ctx, env, requestId });

		try {
			const response = await requestHandler(trustedRequest, context);
			console.log(
				JSON.stringify({
					durationMs: Math.round(performance.now() - startedAt),
					message: "request.complete",
					method: request.method,
					path: new URL(request.url).pathname,
					requestId,
					status: response.status
				})
			);
			return applySecurityHeaders(response, request, env, cspNonce, requestId);
		} catch (error) {
			console.error(
				JSON.stringify({
					error: error instanceof Error ? error.message : "Unknown error",
					message: "request.unhandled",
					method: request.method,
					path: new URL(request.url).pathname,
					requestId
				})
			);
			return applySecurityHeaders(
				Response.json(
					{
						error: { code: "INTERNAL_ERROR", message: "系統暫時無法處理請求" },
						ok: false,
						requestId
					},
					{ status: 500 }
				),
				request,
				env,
				cspNonce,
				requestId
			);
		}
	}
} satisfies ExportedHandler<Env>;
