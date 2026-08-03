import { ArrowLeft, Check, Send } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { data, Form, Link, useNavigation } from "react-router";

import { createApplicationConfirmation, verifyApplicationConfirmation } from "~/features/applications/server/application-confirmation.server";
import { createAccessApplication, markApplicationNotification, normalizeAccessApplicationInput } from "~/features/applications/server/applications.server";
import { notifyDiscordOfApplication } from "~/features/applications/server/discord.server";
import { writeFailureAudit } from "~/features/audit/server/audit.server";
import { getWorkerRuntime } from "~/server/runtime.server";
import { enforceRateLimit } from "~/server/security/rate-limit.server";
import { assertSameOrigin, hashClientIp, readUrlEncodedForm } from "~/server/security/request.server";
import type { AccessApplicationFormInput } from "~/shared/lib/applications";
import { AppError, toAppError } from "~/shared/lib/errors";
import { createPublicMeta } from "~/shared/lib/seo";
import type { Route } from "./+types/apply";
import styles from "./apply.module.css";

const fieldOrder = ["organizationName", "applicantName", "githubLogin", "contact", "requestedNamespace", "currentWebsiteUrl", "purpose", "terms"] as const;
type FieldName = (typeof fieldOrder)[number];
type FormValues = Partial<Record<FieldName, string>>;
type NormalizedApplicationInput = AccessApplicationFormInput & { requestedNamespace: string };

interface ReviewValues {
	readonly applicantName: string;
	readonly contact: string;
	readonly currentWebsiteUrl: string;
	readonly githubLogin: string;
	readonly organizationName: string;
	readonly purpose: string;
	readonly requestedNamespace: string;
	readonly terms: "accepted";
}

type ActionResult =
	| {
			readonly errors?: Record<string, string>;
			readonly message: string;
			readonly ok: boolean;
			readonly phase: "form";
			readonly values: FormValues;
	  }
	| {
			readonly confirmationToken: string;
			readonly editValues: FormValues;
			readonly message: string;
			readonly ok: true;
			readonly phase: "review";
			readonly values: ReviewValues;
	  }
	| {
			readonly applicationId: string;
			readonly message: string;
			readonly ok: true;
			readonly phase: "complete";
	  };

const requiredMessages: Record<Exclude<FieldName, "currentWebsiteUrl">, string> = {
	applicantName: "請填寫申請人姓名",
	contact: "請填寫可聯絡到你的 Email 或 Discord 帳號",
	githubLogin: "請填寫 GitHub username",
	organizationName: "請填寫社團或單位名稱",
	purpose: "請說明網站用途與預計內容",
	requestedNamespace: "請填寫想申請的網域",
	terms: "請確認你了解子網域與使用規範"
};

const fieldLabels: Record<FieldName, string> = {
	applicantName: "申請人姓名",
	contact: "聯絡方式",
	currentWebsiteUrl: "現有網站",
	githubLogin: "GitHub username",
	organizationName: "社團／單位名稱",
	purpose: "網站用途",
	requestedNamespace: "想申請的網域",
	terms: "使用規範"
};

function valuesForRetry(raw: Record<string, string>): FormValues {
	return {
		applicantName: raw.applicantName?.slice(0, 2_000) ?? "",
		contact: raw.contact?.slice(0, 2_000) ?? "",
		currentWebsiteUrl: raw.currentWebsiteUrl?.slice(0, 2_000) ?? "",
		githubLogin: raw.githubLogin?.slice(0, 2_000) ?? "",
		organizationName: raw.organizationName?.slice(0, 2_000) ?? "",
		purpose: raw.purpose?.slice(0, 2_000) ?? "",
		requestedNamespace: (raw.originalRequestedNamespace ?? raw.requestedNamespace)?.slice(0, 2_000) ?? "",
		terms: raw.terms === "accepted" ? "accepted" : ""
	};
}

function reviewValues(input: NormalizedApplicationInput): ReviewValues {
	return {
		applicantName: input.applicantName,
		contact: input.contact,
		currentWebsiteUrl: input.currentWebsiteUrl ?? "",
		githubLogin: input.githubLogin,
		organizationName: input.organizationName,
		purpose: input.purpose,
		requestedNamespace: input.requestedNamespace,
		terms: input.terms
	};
}

function hiddenApplicationFields(values: FormValues | ReviewValues, originalRequestedNamespace?: string) {
	return (
		<>
			{fieldOrder.map(field => (
				<input key={field} name={field} type="hidden" value={values[field] ?? ""} />
			))}
			<input name="website" type="hidden" value="" />
			{originalRequestedNamespace === undefined ? null : <input name="originalRequestedNamespace" type="hidden" value={originalRequestedNamespace} />}
		</>
	);
}

function fieldControl(form: HTMLFormElement, field: FieldName): HTMLInputElement | HTMLTextAreaElement | null {
	const control = form.elements.namedItem(field);
	return control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement ? control : null;
}

function clientValidationMessage(field: FieldName, control: HTMLInputElement | HTMLTextAreaElement): string {
	if (control.validity.valueMissing && field !== "currentWebsiteUrl") return requiredMessages[field];
	if (field === "organizationName" && control.validity.tooShort) return "社團或單位名稱至少需要 2 個字";
	if (field === "applicantName" && control.validity.tooShort) return "申請人姓名至少需要 2 個字";
	if (field === "contact" && control.validity.tooShort) return "聯絡方式至少需要 3 個字";
	if (field === "githubLogin" && control.validity.patternMismatch) return "GitHub username 格式不正確";
	if (field === "currentWebsiteUrl" && control.validity.typeMismatch) return "請輸入有效的網站網址";
	if (field === "purpose" && control.validity.tooShort) return "請用至少 30 個字說明網站用途與預計內容";
	return `${fieldLabels[field]}格式不正確`;
}

export async function action({ context, request }: Route.ActionArgs) {
	const runtime = getWorkerRuntime(context);
	let raw: Record<string, string> = {};
	let intent = "review";
	try {
		if (request.method !== "POST") {
			return data<ActionResult>({ message: "此頁面只接受表單送出", ok: false, phase: "form", values: {} }, { status: 405 });
		}
		assertSameOrigin(request, runtime.env);
		raw = await readUrlEncodedForm(request);
		intent = raw.intent ?? "review";
		if (intent !== "review" && intent !== "edit" && intent !== "confirm") {
			throw new AppError("VALIDATION_ERROR", "無效的表單操作");
		}
		await enforceRateLimit(runtime.env, "auth", await hashClientIp(request, runtime.env), `application-${intent}`);

		if (intent === "edit") {
			return data<ActionResult>({ message: "", ok: true, phase: "form", values: valuesForRetry(raw) });
		}

		const input = normalizeAccessApplicationInput(raw, runtime.env);
		if (intent === "review") {
			const confirmation = await createApplicationConfirmation(input, runtime.env);
			return data<ActionResult>({
				confirmationToken: confirmation.token,
				editValues: valuesForRetry(raw),
				message: "以下資料尚未送出，請確認內容正確。",
				ok: true,
				phase: "review",
				values: reviewValues(input)
			});
		}

		const applicationId = await verifyApplicationConfirmation(raw.confirmationToken, input, runtime.env);
		const application = await createAccessApplication(runtime.env.DB, input, request, runtime.env, runtime.requestId, applicationId);

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
				ok: true,
				phase: "complete"
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
				action: intent === "confirm" ? "application.submit" : "application.validate",
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
				phase: "form",
				values: valuesForRetry(raw)
			},
			{ status: appError.httpStatus }
		);
	}
}

export const meta: Route.MetaFunction = () =>
	createPublicMeta({
		description: "向交大軟體開發社申請免費的 nycu.club 社團網域，審核通過後即可管理 DNS、Proxy 與快取。",
		path: "/apply",
		title: "申請子網域｜nycu.club"
	});

export default function Apply({ actionData }: Route.ComponentProps) {
	const navigation = useNavigation();
	const [clientErrors, setClientErrors] = useState<Partial<Record<FieldName, string>>>({});
	const reviewTitleRef = useRef<HTMLHeadingElement>(null);
	const successTitleRef = useRef<HTMLHeadingElement>(null);
	const errorSummaryRef = useRef<HTMLDivElement>(null);
	const submittingIntent = navigation.formData?.get("intent");
	const submitting = navigation.formAction === "/apply" && navigation.state === "submitting";
	const values = actionData?.phase === "form" ? actionData.values : {};
	const serverErrors = actionData?.phase === "form" ? (actionData.errors ?? {}) : {};
	const errors: Record<string, string> = { ...serverErrors, ...clientErrors };

	useEffect(() => {
		if (actionData?.phase === "review") reviewTitleRef.current?.focus();
		if (actionData?.phase === "complete") successTitleRef.current?.focus();
		if (actionData?.phase !== "form" || !actionData.errors) return;
		const firstField = fieldOrder.find(field => actionData.errors?.[field]);
		if (firstField) {
			document.getElementById(firstField)?.focus();
		} else {
			errorSummaryRef.current?.focus();
		}
	}, [actionData]);

	if (actionData?.phase === "complete") {
		return (
			<main className={styles.success} id="main-content" tabIndex={-1}>
				<span className={styles.successIcon}>
					<Check aria-hidden="true" />
				</span>
				<h1 ref={successTitleRef} tabIndex={-1}>
					申請已送出
				</h1>
				<div aria-live="polite" role="status">
					<p>{actionData.message}</p>
					<p className={styles.reference}>
						申請編號 <code>{actionData.applicationId}</code>
					</p>
				</div>
				<div className={styles.successActions}>
					<Link className="button buttonPrimary" to="/">
						回到首頁
					</Link>
					<Link className="button" to="/login">
						GitHub 登入
					</Link>
				</div>
			</main>
		);
	}

	const errorFor = (field: FieldName) => errors[field];
	const hasError = (field: FieldName) => Boolean(errorFor(field));
	const clearClientError = (field: FieldName) => {
		setClientErrors(current => {
			if (!current[field]) return current;
			return Object.fromEntries(Object.entries(current).filter(([key]) => key !== field));
		});
	};
	const validateForReview = (event: FormEvent<HTMLFormElement>) => {
		const form = event.currentTarget;
		const nextErrors: Partial<Record<FieldName, string>> = {};
		for (const field of fieldOrder) {
			const control = fieldControl(form, field);
			if (control && !control.validity.valid) nextErrors[field] = clientValidationMessage(field, control);
		}
		setClientErrors(nextErrors);
		const firstField = fieldOrder.find(field => nextErrors[field]);
		if (!firstField) return;
		event.preventDefault();
		fieldControl(form, firstField)?.focus();
	};

	return (
		<main className={styles.layout} id="main-content" tabIndex={-1}>
			<aside className={styles.intro}>
				<Link className={styles.back} to="/">
					<ArrowLeft aria-hidden="true" size={17} />
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
						<span>1</span>準備想使用的網域
					</li>
					<li>
						<span>2</span>說明社團與網站用途
					</li>
					<li>
						<span>3</span>確認資料後送出
					</li>
				</ul>
			</aside>

			<section className={styles.formPanel} aria-labelledby={actionData?.phase === "review" ? "confirmation-title" : "application-title"}>
				{actionData?.phase === "review" ? (
					<>
						<div className={styles.formHeading}>
							<h2 id="confirmation-title" ref={reviewTitleRef} tabIndex={-1}>
								確認申請資料
							</h2>
							<p>{actionData.message}</p>
						</div>
						<div className={styles.reviewNotice} role="status">
							資料尚未正式送出。請逐項確認，若內容有誤可返回修改。
						</div>
						<dl className={styles.reviewList}>
							<div>
								<dt>社團／單位名稱</dt>
								<dd>{actionData.values.organizationName}</dd>
							</div>
							<div>
								<dt>申請人姓名</dt>
								<dd>{actionData.values.applicantName}</dd>
							</div>
							<div>
								<dt>GitHub username</dt>
								<dd>@{actionData.values.githubLogin}</dd>
							</div>
							<div>
								<dt>聯絡方式</dt>
								<dd>{actionData.values.contact}</dd>
							</div>
							<div>
								<dt>想申請的網域</dt>
								<dd>{actionData.values.requestedNamespace}</dd>
							</div>
							<div>
								<dt>現有網站</dt>
								<dd>{actionData.values.currentWebsiteUrl || "未提供"}</dd>
							</div>
							<div className={styles.reviewPurpose}>
								<dt>網站用途</dt>
								<dd>{actionData.values.purpose}</dd>
							</div>
							<div>
								<dt>使用規範</dt>
								<dd>已確認</dd>
							</div>
						</dl>
						<div className={styles.reviewActions}>
							<Form action="/apply" method="post">
								<input name="intent" type="hidden" value="edit" />
								{hiddenApplicationFields(actionData.editValues)}
								<button className="button" disabled={submitting} type="submit">
									返回修改
								</button>
							</Form>
							<Form action="/apply" method="post">
								<input name="intent" type="hidden" value="confirm" />
								<input name="confirmationToken" type="hidden" value={actionData.confirmationToken} />
								{hiddenApplicationFields(actionData.values, actionData.editValues.requestedNamespace)}
								<button className="button buttonPrimary" disabled={submitting} type="submit">
									<Send aria-hidden="true" size={18} />
									{submitting && submittingIntent === "confirm" ? "送出中…" : "確認並送出申請"}
								</button>
							</Form>
						</div>
					</>
				) : (
					<>
						<div className={styles.formHeading}>
							<h2 id="application-title">申請資料</h2>
							<p>除標示「選填」外，其餘欄位皆為必填。資料只供平台管理員審核，不會公開顯示。</p>
						</div>
						{Object.keys(errors).length > 0 ? (
							<div className={styles.errorSummary} ref={errorSummaryRef} role="alert" tabIndex={-1}>
								<h3>請修正以下欄位</h3>
								<p>{actionData?.phase === "form" && !actionData.ok ? actionData.message : "表單尚未填寫完整。"}</p>
								<ul>
									{fieldOrder.flatMap(field =>
										errors[field] ? (
											<li key={field}>
												<a href={`#${field}`}>{errors[field]}</a>
											</li>
										) : (
											[]
										)
									)}
									{errors.confirmation ? <li>{errors.confirmation}</li> : null}
								</ul>
							</div>
						) : null}
						<Form action="/apply" method="post" noValidate onSubmit={validateForReview}>
							<input name="intent" type="hidden" value="review" />
							<div className={styles.twoColumns}>
								<div className="field">
									<label htmlFor="organizationName">社團／單位名稱（必填）</label>
									<input
										className="input"
										id="organizationName"
										name="organizationName"
										autoComplete="organization"
										defaultValue={values.organizationName}
										maxLength={120}
										minLength={2}
										placeholder="例如：魔術社"
										required
										aria-invalid={hasError("organizationName") || undefined}
										aria-describedby={errorFor("organizationName") ? "organizationName-error" : undefined}
										onInput={() => clearClientError("organizationName")}
									/>
									{errorFor("organizationName") ? (
										<p className="errorText" id="organizationName-error">
											{errorFor("organizationName")}
										</p>
									) : null}
								</div>
								<div className="field">
									<label htmlFor="applicantName">申請人姓名（必填）</label>
									<input
										className="input"
										id="applicantName"
										name="applicantName"
										autoComplete="name"
										defaultValue={values.applicantName}
										maxLength={100}
										minLength={2}
										placeholder="例如：王小明"
										required
										aria-invalid={hasError("applicantName") || undefined}
										aria-describedby={errorFor("applicantName") ? "applicantName-error" : undefined}
										onInput={() => clearClientError("applicantName")}
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
									<label htmlFor="githubLogin">GitHub username（必填）</label>
									<input
										className="input"
										id="githubLogin"
										name="githubLogin"
										autoCapitalize="none"
										autoComplete="off"
										defaultValue={values.githubLogin}
										maxLength={39}
										pattern="[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?"
										placeholder="例如：magician123"
										required
										spellCheck={false}
										title="請輸入有效的 GitHub username"
										aria-invalid={hasError("githubLogin") || undefined}
										aria-describedby={errorFor("githubLogin") ? "githubLogin-error" : undefined}
										onInput={() => clearClientError("githubLogin")}
									/>
									{errorFor("githubLogin") ? (
										<p className="errorText" id="githubLogin-error">
											{errorFor("githubLogin")}
										</p>
									) : null}
								</div>
								<div className="field">
									<label htmlFor="contact">聯絡方式（必填）</label>
									<input
										className="input"
										id="contact"
										name="contact"
										autoComplete="off"
										defaultValue={values.contact}
										maxLength={160}
										minLength={3}
										placeholder="Email 或 Discord username"
										required
										aria-invalid={hasError("contact") || undefined}
										aria-describedby={errorFor("contact") ? "contact-error" : undefined}
										onInput={() => clearClientError("contact")}
									/>
									{errorFor("contact") ? (
										<p className="errorText" id="contact-error">
											{errorFor("contact")}
										</p>
									) : null}
								</div>
							</div>

							<div className="field">
								<label htmlFor="requestedNamespace">想申請的網域（必填）</label>
								<div className={styles.domainInput}>
									<input
										id="requestedNamespace"
										name="requestedNamespace"
										autoCapitalize="none"
										autoComplete="off"
										defaultValue={values.requestedNamespace}
										maxLength={240}
										placeholder="magic"
										required
										spellCheck={false}
										aria-invalid={hasError("requestedNamespace") || undefined}
										aria-describedby={hasError("requestedNamespace") ? "namespace-help requestedNamespace-error" : "namespace-help"}
										onInput={() => clearClientError("requestedNamespace")}
									/>
									<span className={styles.domainSuffix} aria-hidden="true">
										.nycu.club
									</span>
								</div>
								<p className="helpText" id="namespace-help">
									只要填寫前半段。核准後會包含完整網域與其下層所有子網域，例如 *.magic.nycu.club。
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
									maxLength={500}
									placeholder="https://example.com/…"
									aria-invalid={hasError("currentWebsiteUrl") || undefined}
									aria-describedby={hasError("currentWebsiteUrl") ? "currentWebsiteUrl-error" : undefined}
									onInput={() => clearClientError("currentWebsiteUrl")}
								/>
								{errorFor("currentWebsiteUrl") ? (
									<p className="errorText" id="currentWebsiteUrl-error">
										{errorFor("currentWebsiteUrl")}
									</p>
								) : null}
							</div>

							<div className="field">
								<label htmlFor="purpose">網站用途（必填）</label>
								<textarea
									className="textarea"
									id="purpose"
									name="purpose"
									autoComplete="off"
									defaultValue={values.purpose}
									maxLength={2000}
									minLength={30}
									placeholder="請說明網站內容、預計使用方式與維護人員…"
									required
									rows={6}
									aria-invalid={hasError("purpose") || undefined}
									aria-describedby={hasError("purpose") ? "purpose-help purpose-error" : "purpose-help"}
									onInput={() => clearClientError("purpose")}
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

							<div className={styles.consent}>
								<input
									id="terms"
									name="terms"
									type="checkbox"
									value="accepted"
									defaultChecked={values.terms === "accepted"}
									required
									aria-invalid={hasError("terms") || undefined}
									aria-describedby={hasError("terms") ? "terms-error" : undefined}
									onChange={() => clearClientError("terms")}
								/>
								<label htmlFor="terms">我了解子網域僅供社團使用，且不會進行非法活動。（必填）</label>
							</div>
							{errorFor("terms") ? (
								<p className="errorText" id="terms-error">
									{errorFor("terms")}
								</p>
							) : null}

							<button className={`button buttonPrimary ${styles.submit}`} disabled={submitting} type="submit">
								<Send size={18} aria-hidden="true" />
								{submitting && submittingIntent === "review" ? "檢查中…" : "檢查申請資料"}
							</button>
						</Form>
					</>
				)}
			</section>
		</main>
	);
}
