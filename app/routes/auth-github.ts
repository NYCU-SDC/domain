import { redirect } from "react-router";

import type { Route } from "./+types/auth-github";
import { writeAuditLog } from "../lib/server/audit/audit.server";
import { createGithubAuthorization } from "../lib/server/auth/oauth.server";
import { getWorkerRuntime } from "../lib/server/runtime.server";
import { hashClientIp } from "../lib/server/security/request.server";
import { enforceRateLimit } from "../lib/server/security/rate-limit.server";

export async function loader({ context, request }: Route.LoaderArgs): Promise<Response> {
  const { env, requestId } = getWorkerRuntime(context);
  try {
    await enforceRateLimit(env, "auth", await hashClientIp(request, env), "oauth-start");
    const authorization = await createGithubAuthorization(request, env);
    return redirect(authorization.authorizationUrl, {
      headers: {
        "Cache-Control": "no-store",
        "Set-Cookie": authorization.cookie,
      },
    });
  } catch (error) {
    await writeAuditLog(env.DB, request, env, {
      action: "auth.oauth_error",
      errorCode: "OAUTH_START_FAILED",
      errorMessage: error instanceof Error ? error.message : "OAuth start failed",
      requestId,
      status: "error",
      targetType: "authentication",
    });
    return redirect("/login?error=oauth_failed");
  }
}
