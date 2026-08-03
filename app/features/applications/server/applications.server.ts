import { prepareAuditStatement } from "~/features/audit/server/audit.server";
import type { AuthenticatedSession } from "~/features/auth/server/session.server";
import { getAppConfig } from "~/server/config.server";
import { accessApplicationFormSchema, reviewAccessApplicationSchema, type AccessApplicationFormInput, type AccessApplicationStatus } from "~/shared/lib/applications";
import { normalizeNamespaceGrant } from "~/shared/lib/dns/hostname";
import { AppError, validationErrorFromZod } from "~/shared/lib/errors";

export interface AccessApplicationView {
	readonly adminNote: string | null;
	readonly applicantName: string;
	readonly contact: string;
	readonly createdAt: number;
	readonly currentWebsiteUrl: string | null;
	readonly githubLogin: string;
	readonly id: string;
	readonly notificationError: string | null;
	readonly notificationStatus: "failed" | "pending" | "sent";
	readonly organizationName: string;
	readonly purpose: string;
	readonly requestedNamespace: string;
	readonly reviewedAt: number | null;
	readonly reviewedByLogin: string | null;
	readonly status: AccessApplicationStatus;
	readonly updatedAt: number;
}

interface ApplicationRow {
	readonly adminNote: string | null;
	readonly applicantName: string;
	readonly contact: string;
	readonly createdAt: number;
	readonly currentWebsiteUrl: string | null;
	readonly githubLogin: string;
	readonly id: string;
	readonly notificationError: string | null;
	readonly notificationStatus: "failed" | "pending" | "sent";
	readonly organizationName: string;
	readonly purpose: string;
	readonly requestedNamespace: string;
	readonly reviewedAt: number | null;
	readonly reviewedByLogin: string | null;
	readonly status: AccessApplicationStatus;
	readonly updatedAt: number;
}

const selectColumns = `
  a.id,
  a.organization_name AS organizationName,
  a.applicant_name AS applicantName,
  a.github_login AS githubLogin,
  a.contact,
  a.requested_namespace AS requestedNamespace,
  a.purpose,
  a.current_website_url AS currentWebsiteUrl,
  a.status,
  a.admin_note AS adminNote,
  a.notification_status AS notificationStatus,
  a.notification_error AS notificationError,
  a.reviewed_at AS reviewedAt,
  reviewer.github_login AS reviewedByLogin,
  a.created_at AS createdAt,
  a.updated_at AS updatedAt`;

export function normalizeAccessApplicationInput(raw: unknown, env: Env): AccessApplicationFormInput & { requestedNamespace: string } {
	const parsed = accessApplicationFormSchema.safeParse(raw);
	if (!parsed.success) throw validationErrorFromZod(parsed.error);
	const config = getAppConfig(env);
	const requestedWithoutTrailingDot = parsed.data.requestedNamespace.endsWith(".") ? parsed.data.requestedNamespace.slice(0, -1) : parsed.data.requestedNamespace;
	const requestedLowercase = requestedWithoutTrailingDot.toLowerCase();
	const isFullZoneHostname = requestedLowercase === config.zoneName || requestedLowercase.endsWith(`.${config.zoneName}`);
	const requestedFqdn = isFullZoneHostname ? parsed.data.requestedNamespace : `${parsed.data.requestedNamespace}.${config.zoneName}`;
	return {
		...parsed.data,
		requestedNamespace: normalizeNamespaceGrant(requestedFqdn, config.zoneName, config.protectedHostnames)
	};
}

export async function createAccessApplication(
	database: D1Database,
	input: AccessApplicationFormInput & { requestedNamespace: string },
	request: Request,
	env: Env,
	requestId: string,
	applicationId: string = crypto.randomUUID()
): Promise<AccessApplicationView> {
	const id = applicationId;
	const now = Date.now();
	const audit = await prepareAuditStatement(database, request, env, {
		action: "application.submit",
		actorUserId: null,
		after: {
			githubLogin: input.githubLogin,
			organizationName: input.organizationName,
			requestedNamespace: input.requestedNamespace
		},
		namespace: input.requestedNamespace,
		requestId,
		status: "success",
		targetId: id,
		targetType: "access_application"
	});
	await database.batch([
		database
			.prepare(
				`INSERT INTO access_applications (
          id, organization_name, applicant_name, github_login, contact,
          requested_namespace, purpose, current_website_url, status,
          notification_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'pending', ?, ?)`
			)
			.bind(id, input.organizationName, input.applicantName, input.githubLogin, input.contact, input.requestedNamespace, input.purpose, input.currentWebsiteUrl, now, now),
		audit
	]);
	return {
		adminNote: null,
		applicantName: input.applicantName,
		contact: input.contact,
		createdAt: now,
		currentWebsiteUrl: input.currentWebsiteUrl,
		githubLogin: input.githubLogin,
		id,
		notificationError: null,
		notificationStatus: "pending",
		organizationName: input.organizationName,
		purpose: input.purpose,
		requestedNamespace: input.requestedNamespace,
		reviewedAt: null,
		reviewedByLogin: null,
		status: "pending",
		updatedAt: now
	};
}

export async function markApplicationNotification(database: D1Database, applicationId: string, status: "failed" | "sent", error: string | null): Promise<void> {
	await database
		.prepare(
			`UPDATE access_applications
       SET notification_status = ?, notification_error = ?,
           notification_attempted_at = ?, updated_at = ?
       WHERE id = ?`
		)
		.bind(status, error?.slice(0, 300) ?? null, Date.now(), Date.now(), applicationId)
		.run();
}

export async function listAccessApplications(
	database: D1Database,
	filters: { page: number; search: string; status: "all" | AccessApplicationStatus }
): Promise<{ items: AccessApplicationView[]; page: number; perPage: number; total: number }> {
	const perPage = 25;
	const conditions: string[] = [];
	const params: string[] = [];
	if (filters.status !== "all") {
		conditions.push("a.status = ?");
		params.push(filters.status);
	}
	if (filters.search) {
		const escaped = filters.search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
		conditions.push(`(
      a.organization_name LIKE ? ESCAPE '\\' OR
      a.github_login LIKE ? ESCAPE '\\' OR
      a.requested_namespace LIKE ? ESCAPE '\\' OR
      a.applicant_name LIKE ? ESCAPE '\\'
    )`);
		params.push(...Array.from({ length: 4 }, () => `%${escaped}%`));
	}
	const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
	const [countResult, listResult] = await Promise.all([
		database
			.prepare(`SELECT COUNT(*) AS total FROM access_applications a ${where}`)
			.bind(...params)
			.first<{ total: number }>(),
		database
			.prepare(
				`SELECT ${selectColumns}
         FROM access_applications a
         LEFT JOIN users reviewer ON reviewer.id = a.reviewed_by_user_id
         ${where}
         ORDER BY a.created_at DESC
         LIMIT ? OFFSET ?`
			)
			.bind(...params, perPage, (filters.page - 1) * perPage)
			.all<ApplicationRow>()
	]);
	return {
		items: listResult.results,
		page: filters.page,
		perPage,
		total: countResult?.total ?? 0
	};
}

export async function reviewAccessApplication(raw: unknown, database: D1Database, request: Request, env: Env, actor: AuthenticatedSession, requestId: string): Promise<AccessApplicationView> {
	const parsed = reviewAccessApplicationSchema.safeParse(raw);
	if (!parsed.success) throw validationErrorFromZod(parsed.error);
	const existing = await database
		.prepare(
			`SELECT ${selectColumns}
       FROM access_applications a
       LEFT JOIN users reviewer ON reviewer.id = a.reviewed_by_user_id
       WHERE a.id = ?`
		)
		.bind(parsed.data.applicationId)
		.first<ApplicationRow>();
	if (!existing) throw new AppError("NOT_FOUND", "找不到此申請");

	const now = Date.now();
	const after = {
		adminNote: parsed.data.adminNote,
		reviewedAt: now,
		reviewedByLogin: actor.user.githubLogin,
		status: parsed.data.status
	};
	const audit = await prepareAuditStatement(database, request, env, {
		action: "application.review",
		actorUserId: actor.user.id,
		after,
		before: { adminNote: existing.adminNote, status: existing.status },
		namespace: existing.requestedNamespace,
		requestId,
		status: "success",
		targetId: existing.id,
		targetType: "access_application"
	});
	await database.batch([
		database
			.prepare(
				`UPDATE access_applications
         SET status = ?, admin_note = ?, reviewed_by_user_id = ?, reviewed_at = ?, updated_at = ?
         WHERE id = ?`
			)
			.bind(parsed.data.status, parsed.data.adminNote, actor.user.id, now, now, existing.id),
		audit
	]);
	return { ...existing, ...after, updatedAt: now };
}
