import { Clock3, GitFork, LogOut, Mail } from "lucide-react";
import { redirect } from "react-router";

import type { Route } from "./+types/access-pending";
import { getAuthenticatedSession } from "../lib/server/auth/session.server";
import { getWorkerRuntime } from "../lib/server/runtime.server";
import { createCsrfToken } from "../lib/server/security/request.server";
import styles from "./pending.module.css";

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = getWorkerRuntime(context);
  const session = await getAuthenticatedSession(request, env);
  if (!session) throw redirect("/login");
  if (session.user.status === "active" && (session.user.isAdmin || session.grants.length > 0)) {
    throw redirect("/dashboard");
  }
  return {
    csrfToken: await createCsrfToken(session.id, session.user.id, env),
    user: session.user,
  };
}

export const meta: Route.MetaFunction = () => [{ title: "等待授權｜nycu.club" }];

export default function AccessPending({ loaderData }: Route.ComponentProps) {
  return (
    <main className={styles.page} id="main-content">
      <section className={`card ${styles.card}`}>
        <span className={styles.stateIcon}><Clock3 aria-hidden="true" /></span>
        <p className="eyebrow">ACCESS PENDING</p>
        <img src={loaderData.user.githubAvatarUrl} alt="" width="72" height="72" />
        <h1>你的帳號尚未取得任何 namespace 權限</h1>
        <p>
          <GitFork size={17} aria-hidden="true" /> 已登入為 <b>@{loaderData.user.githubLogin}</b>
        </p>
        <div className={styles.notice}>
          <Mail aria-hidden="true" />
          <div><b>請聯絡系統管理員</b><span>告知你的 GitHub username、所屬社團與需要管理的 namespace。核准後請重新登入。</span></div>
        </div>
        <form action="/logout" method="post">
          <input type="hidden" name="csrfToken" value={loaderData.csrfToken} />
          <button className="button" type="submit"><LogOut size={17} /> 登出</button>
        </form>
        <small>此頁面不會載入 DNS records、其他使用者或 audit 資訊。</small>
      </section>
    </main>
  );
}
