import { AlertTriangle, ClipboardList, ShieldCheck, UserCheck, UserRoundX, Users } from "lucide-react";
import { Link } from "react-router";

import { requireDashboardPage } from "~/features/dashboard/server/page-auth.server";
import { PageHeader } from "~/shared/components/layout/PageHeader";
import type { Route } from "./+types/admin-overview";
import styles from "./admin.module.css";

export async function loader({ context, request }: Route.LoaderArgs) {
	const { runtime } = await requireDashboardPage(request, context, true);
	const [counts, recent, denied, applicationCounts] = await Promise.all([
		runtime.env.DB.prepare(
			`SELECT
          COUNT(*) AS total,
          SUM(status = 'active') AS active,
          SUM(status = 'pending') AS pending,
          SUM(status = 'suspended') AS suspended,
          SUM(is_admin = 1 AND status = 'active') AS admins,
          (SELECT COUNT(*) FROM namespace_grants) AS grants
        FROM users`
		).first<{ active: number; admins: number; grants: number; pending: number; suspended: number; total: number }>(),
		runtime.env.DB.prepare(
			"SELECT id, action, status, created_at AS createdAt FROM audit_logs WHERE action LIKE 'user.%' OR action LIKE 'grant.%' OR action = 'session.revoke' ORDER BY created_at DESC LIMIT 6"
		).all<{ action: string; createdAt: number; id: string; status: string }>(),
		runtime.env.DB.prepare("SELECT id, action, error_code AS errorCode, created_at AS createdAt FROM audit_logs WHERE status = 'denied' ORDER BY created_at DESC LIMIT 6").all<{
			action: string;
			createdAt: number;
			errorCode: string | null;
			id: string;
		}>(),
		runtime.env.DB.prepare("SELECT COUNT(*) AS total, SUM(status = 'pending') AS pending FROM access_applications").first<{ pending: number; total: number }>()
	]);
	return {
		applicationCounts: applicationCounts ?? { pending: 0, total: 0 },
		counts: counts ?? { active: 0, admins: 0, grants: 0, pending: 0, suspended: 0, total: 0 },
		denied: denied.results,
		recent: recent.results
	};
}

export const meta: Route.MetaFunction = () => [{ title: "管理後台｜nycu.club" }];

export default function AdminOverview({ loaderData }: Route.ComponentProps) {
	const metrics = [
		[Users, "Active users", loaderData.counts.active],
		[UserCheck, "Pending users", loaderData.counts.pending],
		[UserRoundX, "Suspended users", loaderData.counts.suspended],
		[ShieldCheck, "Active admins", loaderData.counts.admins]
	] as const;
	return (
		<div>
			<PageHeader
				title="管理後台"
				description="管理申請、使用者、namespace 權限與 session。"
				actions={
					<Link className="button buttonPrimary" to="/admin/applications">
						查看申請
					</Link>
				}
			/>
			<section className={styles.metrics}>
				{metrics.map(([Icon, label, value]) => (
					<article className="card" key={label}>
						<Icon />
						<span>
							<small>{label}</small>
							<strong>{value}</strong>
						</span>
					</article>
				))}
			</section>
			<div className={styles.summary}>
				<div className="card">
					<span>Namespace grants</span>
					<strong>{loaderData.counts.grants}</strong>
				</div>
				<div className="card">
					<span>All users</span>
					<strong>{loaderData.counts.total}</strong>
				</div>
			</div>
			<Link className={`card ${styles.applicationSummary}`} to="/admin/applications">
				<ClipboardList aria-hidden="true" />
				<span>
					<b>{loaderData.applicationCounts.pending} 筆待處理</b>
					<small>共 {loaderData.applicationCounts.total} 筆子網域申請</small>
				</span>
			</Link>
			<div className={styles.columns}>
				<section className="card">
					<h2>最近 admin 操作</h2>
					<ul>
						{loaderData.recent.map(item => (
							<li key={item.id}>
								<b>{item.action}</b>
								<span className="statusPill">{item.status}</span>
							</li>
						))}
					</ul>
				</section>
				<section className="card">
					<h2>
						<AlertTriangle />
						最近被拒絕的操作
					</h2>
					<ul>
						{loaderData.denied.map(item => (
							<li key={item.id}>
								<b>{item.action}</b>
								<span>{item.errorCode ?? "FORBIDDEN"}</span>
							</li>
						))}
					</ul>
				</section>
			</div>
		</div>
	);
}
