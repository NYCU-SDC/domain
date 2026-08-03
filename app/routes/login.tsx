import { GitFork, LockKeyhole, ShieldCheck } from "lucide-react";
import { Link, redirect } from "react-router";

import type { Route } from "./+types/login";
import { getAuthenticatedSession } from "../lib/server/auth/session.server";
import { getWorkerRuntime } from "../lib/server/runtime.server";
import styles from "./login.module.css";

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = getWorkerRuntime(context);
  const session = await getAuthenticatedSession(request, env);
  if (session) {
    if (session.user.status === "active" && (session.user.isAdmin || session.grants.length > 0)) {
      throw redirect("/dashboard");
    }
    throw redirect("/access-pending");
  }
  const error = new URL(request.url).searchParams.get("error");
  const messages: Record<string, string> = {
    account_suspended: "此 GitHub 帳號已被停用。若你認為這是錯誤，請聯絡系統管理員。",
    oauth_failed: "GitHub 登入沒有完成。流程可能已過期、被取消，或 state 驗證失敗；請重新嘗試。",
  };
  return { errorMessage: error ? messages[error] ?? "登入失敗，請重新嘗試。" : null };
}

export const meta: Route.MetaFunction = () => [{ title: "使用 GitHub 登入｜nycu.club" }];

export default function Login({ loaderData }: Route.ComponentProps) {
  return (
    <main className={styles.page} id="main-content">
      <section className={styles.panel}>
        <Link className="brand" to="/"><span className="brandMark">N</span>nycu.club</Link>
        <div className={styles.copy}>
          <p className="eyebrow">SECURE SIGN IN</p>
          <h1>使用 GitHub 帳號登入</h1>
          <p>我們只取得辨識使用者所需的最小 public profile 資訊；Cloudflare 與平台權限由管理員另外配置。</p>
        </div>
        {loaderData.errorMessage ? <div className={styles.error} role="alert">{loaderData.errorMessage}</div> : null}
        <a className={`button buttonPrimary ${styles.githubButton}`} href="/auth/github">
          <GitFork aria-hidden="true" /> 使用 GitHub 繼續
        </a>
        <ul className={styles.permissions}>
          <li><ShieldCheck aria-hidden="true" /><span><b>不要求 repository 權限</b><small>平台不需要讀寫你的任何 repository。</small></span></li>
          <li><LockKeyhole aria-hidden="true" /><span><b>不要求 organization 管理權</b><small>登入只用來確認不可變的 GitHub numeric ID。</small></span></li>
        </ul>
        <p className={styles.pending}>尚未取得權限的使用者，登入後會進入等待管理員授權頁面。</p>
      </section>
      <aside className={styles.aside}>
        <div><span className={styles.gridMark}>N</span><h2>你的 Cloudflare credential<br />不需要離開平台。</h2><p>所有 DNS 與 cache mutation 都由同一個 Worker 驗證 namespace、protected resource、CSRF 與 rate limit。</p></div>
      </aside>
    </main>
  );
}
