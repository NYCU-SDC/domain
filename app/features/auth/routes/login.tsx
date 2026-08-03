import { GitFork } from "lucide-react";
import { Link, redirect } from "react-router";

import { getAuthenticatedSession } from "~/features/auth/server/session.server";
import { getWorkerRuntime } from "~/server/runtime.server";
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

export const meta: Route.MetaFunction = () => [{ title: "登入｜nycu.club" }];

export default function Login({ loaderData }: Route.ComponentProps) {
	return (
		<main className={styles.main} id="main-content">
			<section className={styles.panel}>
				<h1>登入</h1>
				{loaderData.errorMessage ? (
					<div className={styles.error} role="alert">
						{loaderData.errorMessage}
					</div>
				) : null}
				<a className={`button buttonPrimary ${styles.githubButton}`} href="/auth/github">
					<GitFork aria-hidden="true" /> GitHub 登入
				</a>
				<p className={styles.applyPrompt}>
					還沒有權限？ <Link to="/apply">填寫申請表單</Link>
				</p>
			</section>
		</main>
	);
}
