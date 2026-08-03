import { redirect } from "react-router";

import type { RouterContextProvider } from "react-router";
import { requireActiveSession, requireAdminSession } from "~/features/auth/server/session.server";
import { getWorkerRuntime } from "~/server/runtime.server";
import { createCsrfToken } from "~/server/security/request.server";

export async function requireDashboardPage(request: Request, context: Readonly<RouterContextProvider>, admin = false) {
	const runtime = getWorkerRuntime(context);
	try {
		const session = admin ? await requireAdminSession(request, runtime.env) : await requireActiveSession(request, runtime.env);
		return {
			csrfToken: await createCsrfToken(session.id, session.user.id, runtime.env),
			runtime,
			session
		};
	} catch (error) {
		if (error instanceof Response) throw error;
		const pending = await import("~/features/auth/server/session.server").then(({ getAuthenticatedSession }) => getAuthenticatedSession(request, runtime.env));
		if (pending) throw redirect("/access-pending");
		const returnTo = new URL(request.url).pathname;
		throw redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
	}
}
