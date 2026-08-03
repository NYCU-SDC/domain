import { redirect } from "react-router";

import type { Route } from "./+types/auth-callback";
import { writeAuditLog } from "../lib/server/audit/audit.server";
import {
  clearOauthCookie,
  readGithubCallback,
  upsertGithubLogin,
} from "../lib/server/auth/oauth.server";
import { createSession, revokeAllUserSessions } from "../lib/server/auth/session.server";
import { getWorkerRuntime } from "../lib/server/runtime.server";

export async function loader({ context, request }: Route.LoaderArgs): Promise<Response> {
  const { env, requestId } = getWorkerRuntime(context);
  try {
    const identity = await readGithubCallback(request, env);
    const login = await upsertGithubLogin(identity, env);
    if (login.userStatus === "suspended" && !login.isBootstrapAdmin) {
      await revokeAllUserSessions(env.DB, login.userId);
      await writeAuditLog(env.DB, request, env, {
        action: "auth.denied",
        actorUserId: login.userId,
        errorCode: "ACCOUNT_SUSPENDED",
        errorMessage: "Suspended user attempted to sign in",
        requestId,
        status: "denied",
        targetId: login.userId,
        targetType: "user",
      });
      return redirect("/login?error=account_suspended", {
        headers: { "Set-Cookie": clearOauthCookie() },
      });
    }
    const session = await createSession(login.userId, request, env);
    await writeAuditLog(env.DB, request, env, {
      action: "auth.login",
      actorUserId: login.userId,
      after: {
        githubId: identity.id,
        isBootstrapAdmin: login.isBootstrapAdmin,
        sessionId: session.sessionId,
        status: login.userStatus,
      },
      requestId,
      status: "success",
      targetId: login.userId,
      targetType: "user",
    });
    const headers = new Headers({ "Cache-Control": "no-store" });
    headers.append("Set-Cookie", clearOauthCookie());
    headers.append("Set-Cookie", session.cookie);
    return redirect(login.userStatus === "pending" ? "/access-pending" : "/dashboard", {
      headers,
    });
  } catch (error) {
    await writeAuditLog(env.DB, request, env, {
      action: "auth.oauth_error",
      errorCode: "OAUTH_CALLBACK_FAILED",
      errorMessage: error instanceof Error ? error.message : "OAuth callback failed",
      requestId,
      status: "error",
      targetType: "authentication",
    });
    return redirect("/login?error=oauth_failed", {
      headers: { "Set-Cookie": clearOauthCookie() },
    });
  }
}
