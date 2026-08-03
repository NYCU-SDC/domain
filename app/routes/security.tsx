import { EyeOff, KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";

import { PublicHeader } from "../components/PublicHeader";
import type { Route } from "./+types/security";
import styles from "./public-info.module.css";

export const meta: Route.MetaFunction = () => [{ title: "隱私與安全｜nycu.club" }, { name: "description", content: "nycu.club 子網域管理平台的隱私、安全邊界與事件回報說明。" }];

export default function SecurityPage() {
	return (
		<div className={styles.page}>
			<PublicHeader />
			<main className={styles.main} id="main-content">
				<article className={styles.content}>
					<h1>隱私與安全</h1>
					<p className={styles.lead}>
						平台只使用 GitHub public identity 辨識使用者，不要求 repository 或 organization 權限。Cloudflare API Token、OAuth Client Secret、session token 與 IP hash secret 不會送到瀏覽器。
					</p>
					<div className={styles.grid}>
						<article className="card">
							<h2>
								<ShieldCheck />
								Namespace isolation
							</h2>
							<p>DNS 與 cache 操作都以 DNS label boundary 判斷權限；所有 update／delete 會先用 record ID 向 Cloudflare 重新讀取目前資料，再驗證舊名稱與新名稱。</p>
						</article>
						<article className="card">
							<h2>
								<KeyRound />
								Credential handling
							</h2>
							<p>Session 是 server-side opaque token，D1 只保存 SHA-256 hash。GitHub OAuth access token 只存在於 callback call stack，取得 numeric user ID 後立即捨棄。</p>
						</article>
						<article className="card">
							<h2>
								<EyeOff />
								資料最小化
							</h2>
							<p>一般使用者看不到其他 namespace、admin internal note、完整 IP 或 secret；token、cookie、authorization、OAuth code 與 verifier 等敏感欄位也不會顯示。</p>
						</article>
						<article className="card">
							<h2>
								<LockKeyhole />
								安全事件
							</h2>
							<p>若發現可能繞過授權、protected record 或 session 邊界的問題，請私下聯絡軟體開發社維護者，並附上頁面顯示的 request ID；請勿在公開 issue 張貼 credential。</p>
						</article>
					</div>
				</article>
			</main>
		</div>
	);
}
