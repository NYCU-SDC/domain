import { GitFork, KeyRound, LogOut, ShieldCheck } from "lucide-react";

import { apiRequest } from "../lib/client/api";
import styles from "./AccountSessions.module.css";
import { useToast } from "./ToastProvider";

interface Props {
	readonly csrfToken: string;
	readonly grants: string[];
	readonly sessions: ReadonlyArray<{ createdAt: number; current: boolean; expiresAt: number; id: string; lastSeenAt: number; revokedAt: number | null }>;
	readonly user: { githubAvatarUrl: string; githubId: string; githubLogin: string; githubName: string | null; githubProfileUrl: string; isAdmin: boolean };
}

const format = (timestamp: number) => new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" }).format(timestamp);

export function AccountSessions(props: Props) {
	const { showToast } = useToast();
	const revokeOthers = async () => {
		if (!window.confirm("確定撤銷目前裝置以外的所有 sessions？其他裝置需要重新登入。")) return;
		try {
			const result = await apiRequest<{ revoked: number }>("/api/v1/sessions/revoke-others", props.csrfToken, { body: {}, method: "POST" });
			showToast(`已撤銷 ${result.revoked} 個 sessions`, "success");
			window.location.reload();
		} catch (error) {
			showToast(error instanceof Error ? error.message : "撤銷失敗", "error");
		}
	};
	return (
		<div className={styles.grid}>
			<section className={`card ${styles.profile}`}>
				<img src={props.user.githubAvatarUrl} width="84" height="84" alt="" />
				<div>
					<h2>{props.user.githubName ?? props.user.githubLogin}</h2>
					<a href={props.user.githubProfileUrl}>
						<GitFork />@{props.user.githubLogin}
					</a>
					<dl>
						<div>
							<dt>Numeric ID</dt>
							<dd>
								<code>{props.user.githubId}</code>
							</dd>
						</div>
						<div>
							<dt>Role</dt>
							<dd>{props.user.isAdmin ? "Administrator" : "Member"}</dd>
						</div>
					</dl>
				</div>
			</section>
			<section className={`card ${styles.grants}`}>
				<h2>
					<ShieldCheck />
					Namespace grants
				</h2>
				{props.user.isAdmin ? (
					<p>Admin 可以管理所有非 protected DNS records。</p>
				) : props.grants.length ? (
					<ul>
						{props.grants.map(grant => (
							<li key={grant}>
								<b>{grant}</b>
								<small>包含此 namespace 下的所有子網域</small>
							</li>
						))}
					</ul>
				) : (
					<p>目前沒有 namespace grant。</p>
				)}
			</section>
			<section className={`card ${styles.sessions}`}>
				<header>
					<h2>登入中的裝置</h2>
					<button className="button buttonDanger" onClick={revokeOthers} type="button">
						<LogOut aria-hidden="true" />
						撤銷其他 sessions
					</button>
				</header>
				<div className={styles.sessionList}>
					{props.sessions.map(session => (
						<article key={session.id} data-revoked={Boolean(session.revokedAt)}>
							<KeyRound aria-hidden="true" />
							<div>
								<b>{session.current ? "目前 session" : session.revokedAt ? "已撤銷" : "其他 session"}</b>
								<span>最後活動：{format(session.lastSeenAt)}</span>
								<small>
									建立：{format(session.createdAt)} · 到期：{format(session.expiresAt)}
								</small>
							</div>
							{session.current ? (
								<span className="statusPill" data-tone="success">
									目前使用中
								</span>
							) : null}
						</article>
					))}
				</div>
			</section>
		</div>
	);
}
