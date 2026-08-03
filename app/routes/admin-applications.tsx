import { Bell, CheckCircle2, Clock3, ExternalLink, Search, Send, XCircle } from "lucide-react";
import { data, Form, Link, useNavigation } from "react-router";

import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { listAccessApplications, reviewAccessApplication } from "../lib/server/applications/applications.server";
import { writeFailureAudit } from "../lib/server/audit/audit.server";
import { requireDashboardPage } from "../lib/server/pages/page-auth.server";
import { enforceRateLimit } from "../lib/server/security/rate-limit.server";
import { assertCsrfToken, assertSameOrigin, readUrlEncodedForm } from "../lib/server/security/request.server";
import { accessApplicationListQuerySchema, applicationStatuses } from "../lib/shared/applications";
import { toAppError, validationErrorFromZod } from "../lib/shared/errors";
import type { Route } from "./+types/admin-applications";
import styles from "./admin-applications.module.css";

const statusLabels = {
	approved: "已核准",
	pending: "待處理",
	rejected: "不核准",
	reviewing: "審核中"
} as const;

function parseQuery(request: Request) {
	const parsed = accessApplicationListQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
	if (!parsed.success) throw validationErrorFromZod(parsed.error);
	return parsed.data;
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const { csrfToken, runtime } = await requireDashboardPage(request, context, true);
	const filters = parseQuery(request);
	return {
		applications: await listAccessApplications(runtime.env.DB, filters),
		csrfToken,
		filters
	};
}

export async function action({ context, request }: Route.ActionArgs) {
	const { runtime, session } = await requireDashboardPage(request, context, true);
	let raw: Record<string, string> = {};
	try {
		assertSameOrigin(request, runtime.env);
		raw = await readUrlEncodedForm(request, 16_384);
		await assertCsrfToken(raw.csrfToken ?? null, session.id, session.user.id, runtime.env);
		await enforceRateLimit(runtime.env, "admin", session.user.id, "application-review");
		const application = await reviewAccessApplication(raw, runtime.env.DB, request, runtime.env, session, runtime.requestId);
		return data({
			applicationId: application.id,
			message: "審核狀態已更新。",
			ok: true as const
		});
	} catch (error) {
		const appError = toAppError(error);
		await writeFailureAudit(
			runtime.env.DB,
			request,
			runtime.env,
			{
				action: "application.review",
				actorUserId: session.user.id,
				requestId: runtime.requestId,
				targetId: raw.applicationId ?? null,
				targetType: "access_application"
			},
			error
		);
		return data({ message: appError.message, ok: false as const }, { status: appError.httpStatus });
	}
}

export const meta: Route.MetaFunction = () => [{ title: "子網域申請｜nycu.club" }];

function formatDate(timestamp: number): string {
	return new Intl.DateTimeFormat("zh-TW", {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: "Asia/Taipei"
	}).format(timestamp);
}

export default function AdminApplications({ actionData, loaderData }: Route.ComponentProps) {
	const navigation = useNavigation();
	const totalPages = Math.max(1, Math.ceil(loaderData.applications.total / loaderData.applications.perPage));

	return (
		<div>
			<PageHeader title="子網域申請" description="查看公開申請、Discord 通知結果與審核進度。申請人的聯絡資料只在管理後台顯示。" />

			{actionData ? (
				<div className={styles.result} data-ok={actionData.ok} role="status">
					{actionData.message}
				</div>
			) : null}

			<Form className={styles.filters} method="get">
				<label>
					<span className="srOnly">搜尋申請</span>
					<Search size={17} aria-hidden="true" />
					<input name="search" defaultValue={loaderData.filters.search} placeholder="搜尋社團、GitHub 或 namespace…" />
				</label>
				<select name="status" defaultValue={loaderData.filters.status} aria-label="申請狀態">
					<option value="all">全部狀態</option>
					{applicationStatuses.map(status => (
						<option key={status} value={status}>
							{statusLabels[status]}
						</option>
					))}
				</select>
				<button className="button" type="submit">
					套用
				</button>
			</Form>

			<div className={styles.summary}>
				<strong>{loaderData.applications.total}</strong>
				<span>筆申請</span>
			</div>

			{loaderData.applications.items.length ? (
				<section className={styles.list} aria-label="子網域申請清單">
					{loaderData.applications.items.map(application => {
						const saving = navigation.state === "submitting" && navigation.formData?.get("applicationId") === application.id;
						return (
							<article className={styles.application} key={application.id}>
								<header>
									<div className={styles.identity}>
										<span className={styles.status} data-status={application.status}>
											{application.status === "approved" ? <CheckCircle2 /> : application.status === "rejected" ? <XCircle /> : <Clock3 />}
											{statusLabels[application.status]}
										</span>
										<h2>{application.organizationName}</h2>
										<code>{application.requestedNamespace}</code>
									</div>
									<time dateTime={new Date(application.createdAt).toISOString()}>{formatDate(application.createdAt)}</time>
								</header>

								<div className={styles.details}>
									<dl>
										<div>
											<dt>申請人</dt>
											<dd>{application.applicantName}</dd>
										</div>
										<div>
											<dt>GitHub</dt>
											<dd>
												<a href={`https://github.com/${application.githubLogin}`} rel="noreferrer" target="_blank">
													@{application.githubLogin}
													<ExternalLink size={14} />
												</a>
											</dd>
										</div>
										<div>
											<dt>聯絡方式</dt>
											<dd>{application.contact}</dd>
										</div>
										<div>
											<dt>現有網站</dt>
											<dd>
												{application.currentWebsiteUrl ? (
													<a href={application.currentWebsiteUrl} rel="noreferrer" target="_blank">
														開啟網站
														<ExternalLink size={14} />
													</a>
												) : (
													"未提供"
												)}
											</dd>
										</div>
									</dl>
									<div className={styles.purpose}>
										<h3>網站用途</h3>
										<p>{application.purpose}</p>
									</div>
								</div>

								<div className={styles.delivery} data-status={application.notificationStatus}>
									<Bell size={17} aria-hidden="true" />
									<span>
										Discord 通知：
										{application.notificationStatus === "sent" ? "已送達" : application.notificationStatus === "failed" ? "送出失敗" : "等待送出"}
									</span>
									{application.notificationError ? <small>{application.notificationError}</small> : null}
								</div>

								<Form className={styles.reviewForm} method="post">
									<input type="hidden" name="applicationId" value={application.id} />
									<input type="hidden" name="csrfToken" value={loaderData.csrfToken} />
									<label>
										<span>審核狀態</span>
										<select name="status" defaultValue={application.status}>
											{applicationStatuses.map(status => (
												<option key={status} value={status}>
													{statusLabels[status]}
												</option>
											))}
										</select>
									</label>
									<label className={styles.note}>
										<span>管理員備註</span>
										<textarea name="adminNote" defaultValue={application.adminNote ?? ""} rows={3} placeholder="審核依據或後續處理事項…" />
									</label>
									<button className="button buttonPrimary" disabled={saving} type="submit">
										<Send size={16} aria-hidden="true" />
										{saving ? "儲存中…" : "儲存審核"}
									</button>
								</Form>
							</article>
						);
					})}
				</section>
			) : (
				<EmptyState title="沒有符合條件的申請" description="調整搜尋字詞或狀態篩選後再試一次。" />
			)}

			{totalPages > 1 ? (
				<nav className={styles.pagination} aria-label="申請分頁">
					{loaderData.applications.page > 1 ? (
						<Link className="button" to={`?status=${loaderData.filters.status}&search=${encodeURIComponent(loaderData.filters.search)}&page=${loaderData.applications.page - 1}`}>
							上一頁
						</Link>
					) : (
						<span />
					)}
					<span>
						第 {loaderData.applications.page}／{totalPages} 頁
					</span>
					{loaderData.applications.page < totalPages ? (
						<Link className="button" to={`?status=${loaderData.filters.status}&search=${encodeURIComponent(loaderData.filters.search)}&page=${loaderData.applications.page + 1}`}>
							下一頁
						</Link>
					) : (
						<span />
					)}
				</nav>
			) : null}
		</div>
	);
}
