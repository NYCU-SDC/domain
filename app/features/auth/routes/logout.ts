import { redirect } from "react-router";

import { writeAuditLog, writeFailureAudit } from "~/features/audit/server/audit.server";
import { clearSessionCookie, requireAuthenticatedSession, revokeCurrentSession } from "~/features/auth/server/session.server";
import { getWorkerRuntime } from "~/server/runtime.server";
import { assertCsrfToken, assertSameOrigin } from "~/server/security/request.server";
import type { Route } from "./+types/logout";

export async function action({ context, request }: Route.ActionArgs): Promise<Response> {
	const { env, requestId } = getWorkerRuntime(context);
	let actorUserId: string | null = null;
	try {
		const session = await requireAuthenticatedSession(request, env);
		actorUserId = session.user.id;
		assertSameOrigin(request, env);
		const contentType = request.headers.get("Content-Type") ?? "";
		if (!contentType.startsWith("application/x-www-form-urlencoded")) {
			throw new Error("Logout requires form encoding");
		}
		const form = await request.formData();
		const csrfToken = form.get("csrfToken");
		if (typeof csrfToken !== "string") throw new Error("Logout requires a CSRF token");
		await assertCsrfToken(csrfToken, session.id, session.user.id, env);
		const revokedSessionId = await revokeCurrentSession(request, env);
		await writeAuditLog(env.DB, request, env, {
			action: "auth.logout",
			actorUserId,
			after: { revokedSessionId },
			requestId,
			status: "success",
			targetId: revokedSessionId,
			targetType: "session"
		});
	} catch (error) {
		await writeFailureAudit(env.DB, request, env, { action: "auth.logout", actorUserId, requestId, targetType: "session" }, error);
	}
	return redirect("/", { headers: { "Set-Cookie": clearSessionCookie() } });
}
