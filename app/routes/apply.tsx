import { ArrowLeft, Check, Send } from "lucide-react";
import { data, Link, useNavigation } from "react-router";

import { PublicHeader } from "../components/PublicHeader";
import { createAccessApplication, markApplicationNotification, normalizeAccessApplicationInput } from "../lib/server/applications/applications.server";
import { writeFailureAudit } from "../lib/server/audit/audit.server";
import { notifyDiscordOfApplication } from "../lib/server/notifications/discord.server";
import { getWorkerRuntime } from "../lib/server/runtime.server";
import { enforceRateLimit } from "../lib/server/security/rate-limit.server";
import { assertSameOrigin, hashClientIp, readUrlEncodedForm } from "../lib/server/security/request.server";
import { toAppError } from "../lib/shared/errors";
import type { Route } from "./+types/apply";
import styles from "./apply.module.css";

interface ActionResult {
	readonly applicationId?: string;
	readonly errors?: Record<string, string>;
	readonly message: string;
	readonly ok: boolean;
	readonly values?: Record<string, string>;
}

function valuesForRetry(raw: Record<string, string>): Record<string, string> {
	return Object.fromEntries(
		Object.entries(raw)
			.filter(([key]) => key !== "website" && key !== "terms")
			.map(([key, value]) => [key, value.slice(0, 2_000)])
	);
}

export async function action({ context, request }: Route.ActionArgs) {
	const runtime = getWorkerRuntime(context);
	let raw: Record<string, string> = {};
	try {
		if (request.method !== "POST") {
			return data<ActionResult>({ message: "此頁面只接受表單送出", ok: false }, { status: 405 });
		}
		assertSameOrigin(request, runtime.env);
		await enforceRateLimit(runtime.env, "auth", await hashClientIp(request, runtime.env), "application-submit");
		raw = await readUrlEncodedForm(request);
		const input = normalizeAccessApplicationInput(raw, runtime.env);
		const application = await createAccessApplication(runtime.env.DB, input, request, runtime.env, runtime.requestId);

		runtime.ctx.waitUntil(
			(async () => {
				try {
					await notifyDiscordOfApplication(application, runtime.env, runtime.requestId);
					await markApplicationNotification(runtime.env.DB, application.id, "sent", null);
				} catch (error) {
					const safeError = toAppError(error);
					try {
						await markApplicationNotification(runtime.env.DB, application.id, "failed", safeError.message);
					} catch (updateError) {
						console.error(
							JSON.stringify({
								applicationId: application.id,
								error: updateError instanceof Error ? updateError.message : "Unknown error",
								message: "application.notification_status_failed",
								requestId: runtime.requestId
							})
						);
					}
					console.error(
						JSON.stringify({
							applicationId: application.id,
							error: safeError.message,
							message: "application.discord_notification_failed",
							requestId: runtime.requestId
						})
					);
				}
			})()
		);

		return data<ActionResult>(
			{
				applicationId: application.id,
				message: "申請已送出，軟體開發社會依你留下的聯絡方式回覆。",
				ok: true
			},
			{ status: 201 }
		);
	} catch (error) {
		const appError = toAppError(error);
		await writeFailureAudit(
			runtime.env.DB,
			request,
			runtime.env,
			{
				action: "application.submit",
				actorUserId: null,
				namespace: raw.requestedNamespace ?? null,
				requestId: runtime.requestId,
				targetType: "access_application"
			},
			error
		);
		return data<ActionResult>(
			{
				errors: Object.fromEntries((appError.details ?? []).map(({ field, message }) => [field, message])),
				message: appError.message,
				ok: false,
				values: valuesForRetry(raw)
			},
			{ status: appError.httpStatus }
		);
	}
}

export const meta: Route.MetaFunction = () => [
	{ title: "申請子網域｜nycu.club" },
	{
		content: "向交大軟體開發社申請 nycu.club 社團 namespace。",
		name: "description"
	}
];

export default function Apply({ actionData }: Route.ComponentProps) {
	const navigation = useNavigation();
	const submitting = navigation.formAction === "/apply";
	const values = actionData?.values ?? {};

	if (actionData?.ok) {
		return (
			<div className={styles.page}>
				<PublicHeader />
				<main className={styles.success} id="main-content">
					<span className={styles.successIcon}>
						<Check aria-hidden="true" />
					</span>
					<h1>申請已送出</h1>
					<p>{actionData.message}</p>
					<p className={styles.reference}>
						申請編號 <code>{actionData.applicationId}</code>
					</p>
					<div className={styles.successActions}>
						<Link className="button buttonPrimary" to="/">
							回到首頁
						</Link>
						<Link className="button" to="/login">
							GitHub 登入
						</Link>
					</div>
				</main>
			</div>
		);
	}

	const errorFor = (field: string) => actionData?.errors?.[field];
	const hasError = (field: string) => Boolean(errorFor(field));
	return (
		<div className={styles.page}>
			<PublicHeader />
			<main className={styles.layout} id="main-content">
				<aside className={styles.intro}>
					<Link className={styles.back} to="/">
						<ArrowLeft size={17} />
						回到首頁
					</Link>
					<h1>
						申請一個
						<br />
						<span translate="no">nycu.club</span>
						<br />
						子網域
					</h1>
					<p>這份表單會送到交大軟體開發社。審核通過後，再用 GitHub 登入管理 DNS、Proxy 與快取。</p>
					<ul>
						<li>
							<span>1</span>準備想使用的 namespace
						</li>
						<li>
							<span>2</span>說明社團與網站用途
						</li>
						<li>
							<span>3</span>留下可聯絡的帳號
						</li>
					</ul>
				</aside>

				<section className={styles.formPanel} aria-labelledby="application-title">
					<div className={styles.formHeading}>
						<h2 id="application-title">申請資料</h2>
						<p>全部欄位只供平台管理員審核，不會公開顯示。</p>
					</div>
					{actionData && !actionData.ok ? (
						<div className={styles.formError} role="alert">
							{actionData.message}
						</div>
					) : null}
					<form action="/apply" method="post">
						<div className={styles.twoColumns}>
							<div className="field">
								<label htmlFor="organizationName">社團／單位名稱</label>
								<input
									className="input"
									id="organizationName"
									name="organizationName"
									autoComplete="organization"
									defaultValue={values.organizationName}
									placeholder="例如：魔術社"
									aria-invalid={hasError("organizationName") || undefined}
									aria-describedby={errorFor("organizationName") ? "organizationName-error" : undefined}
								/>
								{errorFor("organizationName") ? (
									<p className="errorText" id="organizationName-error">
										{errorFor("organizationName")}
									</p>
								) : null}
							</div>
							<div className="field">
								<label htmlFor="applicantName">申請人姓名</label>
								<input
									className="input"
									id="applicantName"
									name="applicantName"
									autoComplete="name"
									defaultValue={values.applicantName}
									placeholder="例如：王小明"
									aria-invalid={hasError("applicantName") || undefined}
									aria-describedby={errorFor("applicantName") ? "applicantName-error" : undefined}
								/>
								{errorFor("applicantName") ? (
									<p className="errorText" id="applicantName-error">
										{errorFor("applicantName")}
									</p>
								) : null}
							</div>
						</div>

						<div className={styles.twoColumns}>
							<div className="field">
								<label htmlFor="githubLogin">GitHub username</label>
								<input
									className="input"
									id="githubLogin"
									name="githubLogin"
									autoCapitalize="none"
									autoComplete="off"
									defaultValue={values.githubLogin}
									placeholder="例如：magician123"
									spellCheck={false}
									aria-invalid={hasError("githubLogin") || undefined}
									aria-describedby={errorFor("githubLogin") ? "githubLogin-error" : undefined}
								/>
								{errorFor("githubLogin") ? (
									<p className="errorText" id="githubLogin-error">
										{errorFor("githubLogin")}
									</p>
								) : null}
							</div>
							<div className="field">
								<label htmlFor="contact">聯絡方式</label>
								<input
									className="input"
									id="contact"
									name="contact"
									autoComplete="email"
									defaultValue={values.contact}
									placeholder="Email 或 Discord username"
									aria-invalid={hasError("contact") || undefined}
									aria-describedby={errorFor("contact") ? "contact-error" : undefined}
								/>
								{errorFor("contact") ? (
									<p className="errorText" id="contact-error">
										{errorFor("contact")}
									</p>
								) : null}
							</div>
						</div>

						<div className="field">
							<label htmlFor="requestedNamespace">想申請的 namespace</label>
							<input
								className="input"
								id="requestedNamespace"
								name="requestedNamespace"
								autoCapitalize="none"
								autoComplete="off"
								defaultValue={values.requestedNamespace}
								placeholder="例如：magic.nycu.club"
								spellCheck={false}
								aria-invalid={hasError("requestedNamespace") || undefined}
								aria-describedby={hasError("requestedNamespace") ? "namespace-help requestedNamespace-error" : "namespace-help"}
							/>
							<p className="helpText" id="namespace-help">
								核准後會包含此名稱與下層所有子網域，例如 *.magic.nycu.club。
							</p>
							{errorFor("requestedNamespace") ? (
								<p className="errorText" id="requestedNamespace-error">
									{errorFor("requestedNamespace")}
								</p>
							) : null}
						</div>

						<div className="field">
							<label htmlFor="currentWebsiteUrl">現有網站（選填）</label>
							<input
								className="input"
								id="currentWebsiteUrl"
								name="currentWebsiteUrl"
								type="url"
								inputMode="url"
								autoComplete="url"
								defaultValue={values.currentWebsiteUrl}
								placeholder="https://example.com/…"
								aria-invalid={hasError("currentWebsiteUrl") || undefined}
								aria-describedby={hasError("currentWebsiteUrl") ? "currentWebsiteUrl-error" : undefined}
							/>
							{errorFor("currentWebsiteUrl") ? (
								<p className="errorText" id="currentWebsiteUrl-error">
									{errorFor("currentWebsiteUrl")}
								</p>
							) : null}
						</div>

						<div className="field">
							<label htmlFor="purpose">網站用途</label>
							<textarea
								className="textarea"
								id="purpose"
								name="purpose"
								autoComplete="off"
								defaultValue={values.purpose}
								placeholder="請說明網站內容、預計使用方式與維護人員…"
								rows={6}
								aria-invalid={hasError("purpose") || undefined}
								aria-describedby={hasError("purpose") ? "purpose-help purpose-error" : "purpose-help"}
							/>
							<p className="helpText" id="purpose-help">
								至少 30 個字，最多 2,000 個字。
							</p>
							{errorFor("purpose") ? (
								<p className="errorText" id="purpose-error">
									{errorFor("purpose")}
								</p>
							) : null}
						</div>

						<div className={styles.honeypot} aria-hidden="true">
							<label htmlFor="website">請勿填寫</label>
							<input id="website" name="website" tabIndex={-1} autoComplete="off" />
						</div>

						<label className={styles.consent}>
							<input name="terms" type="checkbox" value="accepted" aria-invalid={hasError("terms") || undefined} aria-describedby={hasError("terms") ? "terms-error" : undefined} />
							<span>我了解 namespace 只限申請用途，並同意依平台安全規範管理 DNS。</span>
						</label>
						{errorFor("terms") ? (
							<p className="errorText" id="terms-error">
								{errorFor("terms")}
							</p>
						) : null}

						<button className={`button buttonPrimary ${styles.submit}`} disabled={submitting} type="submit">
							<Send size={18} aria-hidden="true" />
							{submitting ? "送出中…" : "送出申請"}
						</button>
					</form>
				</section>
			</main>
		</div>
	);
}
