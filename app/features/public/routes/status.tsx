import { Activity, CheckCircle2, ExternalLink } from "lucide-react";

import type { Route } from "./+types/status";
import styles from "./public-info.module.css";

export const meta: Route.MetaFunction = () => [{ title: "系統狀態｜nycu.club" }, { name: "description", content: "nycu.club 子網域管理平台狀態入口。" }];

export default function StatusPage() {
	return (
		<main className={styles.main} id="main-content">
			<article className={styles.content}>
				<h1>服務狀態入口</h1>
				<p className={styles.lead}>獨立的外部 status provider 尚未綁定。此頁保留為正式狀態入口；事故期間即使 dashboard 不可用，也應由維護者在外部狀態頁更新資訊。</p>
				<div className={styles.status}>
					<CheckCircle2 />
					<span>
						<b>應用程式已回應</b>
						<small>你能看到此頁，代表 nycu.club Worker 與 SSR route 目前可提供內容。</small>
					</span>
				</div>
				<div className={styles.grid}>
					<article className="card">
						<h2>
							<Activity />
							Dependency status
						</h2>
						<p>DNS mutation、GitHub OAuth、D1 與 cache purge 仍分別依賴 Cloudflare 與 GitHub 服務。維護者應在部署時將此入口連結到獨立監控服務。</p>
					</article>
					<article className="card">
						<h2>
							<ExternalLink />
							Incident support
						</h2>
						<p>遇到錯誤時請保留 request ID、時間與操作類型後聯絡軟體開發社。請勿傳送 cookie、OAuth code 或 API Token。</p>
					</article>
				</div>
			</article>
		</main>
	);
}
