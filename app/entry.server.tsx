import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";
import type { EntryContext, RouterContextProvider } from "react-router";
import { ServerRouter } from "react-router";

import { getWorkerRuntime } from "./lib/server/runtime.server";

export const streamTimeout = 5_000;

export default async function handleRequest(
	request: Request,
	responseStatusCode: number,
	responseHeaders: Headers,
	routerContext: EntryContext,
	loadContext: RouterContextProvider
): Promise<Response> {
	if (request.method.toUpperCase() === "HEAD") {
		return new Response(null, {
			headers: responseHeaders,
			status: responseStatusCode
		});
	}

	const { cspNonce } = getWorkerRuntime(loadContext);
	let shellRendered = false;
	const body = await renderToReadableStream(<ServerRouter context={routerContext} nonce={cspNonce} url={request.url} />, {
		nonce: cspNonce,
		onError(error: unknown) {
			responseStatusCode = 500;
			if (shellRendered) console.error(error);
		},
		signal: AbortSignal.timeout(streamTimeout + 1_000)
	});
	shellRendered = true;

	const userAgent = request.headers.get("user-agent");
	if ((userAgent && isbot(userAgent)) || routerContext.isSpaMode) await body.allReady;

	responseHeaders.set("Content-Type", "text/html");
	return new Response(body, {
		headers: responseHeaders,
		status: responseStatusCode
	});
}
