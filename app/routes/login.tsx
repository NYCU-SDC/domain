import { GitFork, LockKeyhole, ShieldCheck } from "lucide-react";
import { Link, redirect } from "react-router";

import { PublicHeader } from "../components/PublicHeader";
import { getAuthenticatedSession } from "../lib/server/auth/session.server";
import { getWorkerRuntime } from "../lib/server/runtime.server";
import type { Route } from "./+types/login";
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
		oauth_failed: "GitHub 登入沒有完成。流程可能已過期、被取消，或 state 驗證失敗；請重新嘗試。"
	};
	return { errorMessage: error ? (messages[error] ?? "登入失敗，請重新嘗試。") : null };
}

export const meta: Route.MetaFunction = () => [{ title: "使用 GitHub 登入｜nycu.club" }];

export default function Login({ loaderData }: Route.ComponentProps) {
	return (
		<div className={styles.page}>
			<PublicHeader />
			<main className={styles.main} id="main-content">
				<aside className={styles.intro}>
					<h2>
						一個帳號，
						<br />
						只管理你的範圍。
					</h2>
					<p>GitHub 只用來確認身分。DNS 與快取權限由交大軟體開發社另外配置。</p>
					<Link to="/apply">還沒有權限？填寫申請表單</Link>
				</aside>
				<section className={styles.panel}>
					<div className={styles.copy}>
						<h1>使用 GitHub 帳號登入</h1>
						<p>只讀取 GitHub numeric ID、username、姓名、頭像與公開個人頁面。</p>
					</div>
					{loaderData.errorMessage ? (
						<div className={styles.error} role="alert">
							{loaderData.errorMessage}
						</div>
					) : null}
					<a className={`button buttonPrimary ${styles.githubButton}`} href="/auth/github">
						<GitFork aria-hidden="true" /> 使用 GitHub 繼續
					</a>
					<ul className={styles.permissions}>
						<li>
							<ShieldCheck aria-hidden="true" />
							<span>
								<b>不要求 repository 權限</b>
								<small>平台不會讀寫你的 repository。</small>
							</span>
						</li>
						<li>
							<LockKeyhole aria-hidden="true" />
							<span>
								<b>不要求 organization 管理權</b>
								<small>權限綁定不可變的 GitHub numeric ID。</small>
							</span>
						</li>
					</ul>
					<p className={styles.pending}>尚未核准的帳號登入後，只會看到等待授權頁面。</p>
				</section>
			</main>
		</div>
	);
}
