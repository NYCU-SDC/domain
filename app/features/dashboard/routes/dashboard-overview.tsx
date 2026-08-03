import { Activity, Cloud, Database, RadioTower, ShieldCheck } from "lucide-react";
import { Link } from "react-router";

import { requireDashboardPage } from "~/features/dashboard/server/page-auth.server";
import { listAuthorizedDnsRecords } from "~/features/dns/server/records.server";
import { PageHeader } from "~/shared/components/layout/PageHeader";
import { safeErrorDiagnostics, toAppError } from "~/shared/lib/errors";
import { createPrivateMeta } from "~/shared/lib/seo";
import type { Route } from "./+types/dashboard-overview";
import styles from "./overview.module.css";

export async function loader({ context, request }: Route.LoaderArgs) {
	const { runtime, session } = await requireDashboardPage(request, context);
	let records: Awaited<ReturnType<typeof listAuthorizedDnsRecords>> = [];
	let upstreamError: string | null = null;
	try {
		records = await listAuthorizedDnsRecords(session, runtime.env, runtime.requestId);
	} catch (error) {
		const appError = toAppError(error);
		console.error(
			JSON.stringify({
				code: appError.code,
				...safeErrorDiagnostics(error),
				message: "dashboard.dns-summary.failed",
				requestId: runtime.requestId,
				safeError: appError.message,
				userId: session.user.id
			})
		);
		upstreamError = "目前無法讀取 Cloudflare DNS；請稍後重新整理，或提供 request ID 給管理員。";
	}
	const recent = await runtime.env.DB.prepare(
		`SELECT id, action, namespace, hostname, status, created_at AS createdAt
       FROM audit_logs WHERE actor_user_id = ? ORDER BY created_at DESC LIMIT 6`
	)
		.bind(session.user.id)
		.all<{
			action: string;
			createdAt: number;
			hostname: string | null;
			id: string;
			namespace: string | null;
			status: string;
		}>();
	const lastPurge = recent.results.find(event => event.action.startsWith("cache.purge"));
	return {
		counts: {
			namespaces: session.user.isAdmin ? "全部" : session.grants.length,
			proxied: records.filter(record => record.proxied).length,
			records: records.length
		},
		lastPurge: lastPurge?.createdAt ?? null,
		recent: recent.results,
		requestId: runtime.requestId,
		upstreamError
	};
}

export const meta: Route.MetaFunction = () => createPrivateMeta("總覽｜nycu.club");

function formatTime(timestamp: number | null): string {
	if (!timestamp) return "尚無紀錄";
	return new Intl.DateTimeFormat("zh-TW", {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: "Asia/Taipei"
	}).format(timestamp);
}

export default function DashboardOverview({ loaderData }: Route.ComponentProps) {
	return (
		<div>
			<PageHeader
				title="基礎設施總覽"
				description="DNS 資料直接來自 Cloudflare；這裡只顯示目前帳號被授權的 namespace。"
				actions={
					<Link className="button buttonPrimary" to="/dashboard/dns">
						管理 DNS Records
					</Link>
				}
			/>
			{loaderData.upstreamError ? (
				<div className={styles.error} role="alert">
					<Cloud aria-hidden="true" />{" "}
					<span>
						{loaderData.upstreamError}
						<small>Request ID: {loaderData.requestId}</small>
					</span>
				</div>
			) : null}
			<section className={styles.metrics} aria-label="統計資料">
				<article className="card">
					<span>
						<RadioTower aria-hidden="true" />
					</span>
					<div>
						<small>可管理 namespace</small>
						<strong>{loaderData.counts.namespaces}</strong>
					</div>
				</article>
				<article className="card">
					<span>
						<Database aria-hidden="true" />
					</span>
					<div>
						<small>DNS records</small>
						<strong>{loaderData.counts.records}</strong>
					</div>
				</article>
				<article className="card">
					<span>
						<Cloud aria-hidden="true" />
					</span>
					<div>
						<small>Proxied records</small>
						<strong>{loaderData.counts.proxied}</strong>
					</div>
				</article>
				<article className="card">
					<span>
						<Activity aria-hidden="true" />
					</span>
					<div>
						<small>最近 cache purge</small>
						<strong className={styles.time}>{formatTime(loaderData.lastPurge)}</strong>
					</div>
				</article>
			</section>
			<div className={styles.columns}>
				<section className={`card ${styles.recent}`}>
					<div className={styles.sectionTop}>
						<h2>最近操作</h2>
						<Link to="/dashboard/audit">查看全部</Link>
					</div>
					{loaderData.recent.length ? (
						<ul>
							{loaderData.recent.map(event => (
								<li key={event.id}>
									<span className="statusPill" data-tone={event.status === "success" ? "success" : event.status === "denied" ? "danger" : "warning"}>
										{event.status}
									</span>
									<div>
										<b>{event.action}</b>
										<small>{event.hostname ?? event.namespace ?? "帳號操作"}</small>
									</div>
									<time dateTime={new Date(event.createdAt).toISOString()}>{formatTime(event.createdAt)}</time>
								</li>
							))}
						</ul>
					) : (
						<p className={styles.muted}>目前還沒有任何操作紀錄。</p>
					)}
				</section>
				<aside className={`card ${styles.security}`}>
					<span>
						<ShieldCheck aria-hidden="true" />
					</span>
					<h2>先確認目標，再執行 mutation</h2>
					<p>更新或刪除 DNS record 時，後端會用 record ID 重新讀取 Cloudflare 現況，並同時驗證舊 hostname 與新 hostname。</p>
					<Link to="/dashboard/audit">查看可稽核資訊</Link>
				</aside>
			</div>
		</div>
	);
}
