import { and, asc, count, eq, like, or, sql } from "drizzle-orm";

import type { CreateUserInput, UpdateUserInput } from "../../shared/admin";
import {
  normalizeGrantSet,
  normalizeNamespaceGrant,
} from "../../shared/dns/hostname";
import { AppError } from "../../shared/errors";
import type { AuditEvent } from "../audit/audit.server";
import { prepareAuditStatement } from "../audit/audit.server";
import type { AuthenticatedSession } from "../auth/session.server";
import { getAppConfig } from "../config.server";
import { createDb } from "../db/client.server";
import { users } from "../db/schema.server";
import {
  resolvePublicGithubUser,
  type GithubIdentity,
} from "../github/client.server";

export interface AdminUserView {
  readonly createdAt: number;
  readonly githubAvatarUrl: string;
  readonly githubId: string;
  readonly githubLogin: string;
  readonly githubName: string | null;
  readonly githubProfileUrl: string;
  readonly grants: string[];
  readonly id: string;
  readonly isAdmin: boolean;
  readonly isBootstrapAdmin: boolean;
  readonly lastLoginAt: number | null;
  readonly note: string | null;
  readonly status: "active" | "pending" | "suspended";
  readonly updatedAt: number;
}

async function getGrantsByUserIds(
  database: D1Database,
  userIds: readonly string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (userIds.length === 0) return result;
  const placeholders = userIds.map(() => "?").join(",");
  const rows = await database
    .prepare(
      `SELECT user_id AS userId, namespace FROM namespace_grants
       WHERE user_id IN (${placeholders}) ORDER BY namespace ASC`,
    )
    .bind(...userIds)
    .all<{ userId: string; namespace: string }>();
  for (const row of rows.results) {
    const grants = result.get(row.userId) ?? [];
    grants.push(row.namespace);
    result.set(row.userId, grants);
  }
  return result;
}

export async function getAdminUser(
  database: D1Database,
  env: Env,
  userId: string,
): Promise<AdminUserView> {
  const db = createDb(database);
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = rows[0];
  if (!user) throw new AppError("NOT_FOUND", "找不到此使用者");
  const grants = await getGrantsByUserIds(database, [user.id]);
  return {
    ...user,
    grants: grants.get(user.id) ?? [],
    isBootstrapAdmin: getAppConfig(env).bootstrapAdminGithubIds.has(user.githubId),
  };
}

export async function listAdminUsers(
  database: D1Database,
  env: Env,
  filters: {
    admin: "all" | "no" | "yes";
    namespace?: string;
    page: number;
    perPage: number;
    search: string;
    status: "active" | "all" | "pending" | "suspended";
  },
): Promise<{ items: AdminUserView[]; page: number; perPage: number; total: number }> {
  const db = createDb(database);
  const conditions = [];
  if (filters.status !== "all") conditions.push(eq(users.status, filters.status));
  if (filters.admin !== "all") conditions.push(eq(users.isAdmin, filters.admin === "yes"));
  if (filters.search) {
    const query = `%${filters.search.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    conditions.push(
      or(
        like(users.githubLogin, query),
        like(users.githubId, query),
        like(users.note, query),
      ),
    );
  }
  if (filters.namespace) {
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM namespace_grants ng
        WHERE ng.user_id = ${users.id} AND ng.namespace = ${filters.namespace}
      )`,
    );
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ total }, rows] = await Promise.all([
    db.select({ total: count() }).from(users).where(where).then((result) => result[0] ?? { total: 0 }),
    db
      .select()
      .from(users)
      .where(where)
      .orderBy(asc(users.githubLogin))
      .limit(filters.perPage)
      .offset((filters.page - 1) * filters.perPage),
  ]);
  const grants = await getGrantsByUserIds(database, rows.map((user) => user.id));
  const bootstrapIds = getAppConfig(env).bootstrapAdminGithubIds;
  return {
    items: rows.map((user) => ({
      ...user,
      grants: grants.get(user.id) ?? [],
      isBootstrapAdmin: bootstrapIds.has(user.githubId),
    })),
    page: filters.page,
    perPage: filters.perPage,
    total,
  };
}

function normalizeRequestedGrants(grants: readonly string[], env: Env): string[] {
  const config = getAppConfig(env);
  return normalizeGrantSet(
    grants.map((grant) =>
      normalizeNamespaceGrant(grant, config.zoneName, config.protectedHostnames),
    ),
  );
}

async function auditStatementsForUserUpdate(
  database: D1Database,
  request: Request,
  env: Env,
  actor: AuthenticatedSession,
  requestId: string,
  before: AdminUserView,
  after: AdminUserView,
): Promise<D1PreparedStatement[]> {
  const base = {
    actorUserId: actor.user.id,
    after,
    before,
    requestId,
    status: "success" as const,
    targetId: before.id,
    targetType: "user",
  };
  const events: AuditEvent[] = [{ ...base, action: "user.update" }];
  if (before.status !== after.status) {
    events.push({
      ...base,
      action: after.status === "suspended" ? "user.suspend" : "user.activate",
    });
  }
  if (before.isAdmin !== after.isAdmin) {
    events.push({
      ...base,
      action: after.isAdmin ? "user.admin_grant" : "user.admin_revoke",
    });
  }
  if (before.note !== after.note) events.push({ ...base, action: "user.note_update" });
  for (const grant of after.grants.filter((grant) => !before.grants.includes(grant))) {
    events.push({ ...base, action: "grant.add", namespace: grant, targetType: "namespace_grant" });
  }
  for (const grant of before.grants.filter((grant) => !after.grants.includes(grant))) {
    events.push({ ...base, action: "grant.remove", namespace: grant, targetType: "namespace_grant" });
  }
  return Promise.all(
    events.map((event) => prepareAuditStatement(database, request, env, event)),
  );
}

export async function createAdminUser(
  input: CreateUserInput,
  request: Request,
  env: Env,
  actor: AuthenticatedSession,
  requestId: string,
  fetcher?: typeof fetch,
): Promise<AdminUserView> {
  const identity = await resolvePublicGithubUser(input.username, fetcher);
  const existing = await env.DB
    .prepare("SELECT id FROM users WHERE github_id = ?")
    .bind(identity.id)
    .first<{ id: string }>();
  if (existing) {
    throw new AppError("CONFLICT", `此 GitHub identity 已存在（user ID: ${existing.id}）`);
  }
  const grants = normalizeRequestedGrants(input.grants, env);
  const now = Date.now();
  const userId = crypto.randomUUID();
  const isBootstrapAdmin = getAppConfig(env).bootstrapAdminGithubIds.has(identity.id);
  const isAdmin = input.isAdmin || isBootstrapAdmin;
  const status = isAdmin ? "active" : input.status;
  const view: AdminUserView = {
    createdAt: now,
    githubAvatarUrl: identity.avatarUrl,
    githubId: identity.id,
    githubLogin: identity.login,
    githubName: identity.name,
    githubProfileUrl: identity.profileUrl,
    grants,
    id: userId,
    isAdmin,
    isBootstrapAdmin,
    lastLoginAt: null,
    note: input.note,
    status,
    updatedAt: now,
  };
  const statements: D1PreparedStatement[] = [
    env.DB
      .prepare(
        `INSERT INTO users (
          id, github_id, github_login, github_name, github_avatar_url,
          github_profile_url, status, is_admin, note, created_at, updated_at, last_login_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .bind(
        userId,
        identity.id,
        identity.login,
        identity.name,
        identity.avatarUrl,
        identity.profileUrl,
        status,
        isAdmin ? 1 : 0,
        input.note,
        now,
        now,
      ),
    ...grants.map((grant) =>
      env.DB
        .prepare(
          "INSERT INTO namespace_grants (id, user_id, namespace, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(crypto.randomUUID(), userId, grant, actor.user.id, now),
    ),
    await prepareAuditStatement(env.DB, request, env, {
      action: "user.create",
      actorUserId: actor.user.id,
      after: view,
      requestId,
      status: "success",
      targetId: userId,
      targetType: "user",
    }),
  ];
  await env.DB.batch(statements);
  return view;
}

export async function updateAdminUser(
  userId: string,
  input: UpdateUserInput,
  request: Request,
  env: Env,
  actor: AuthenticatedSession,
  requestId: string,
): Promise<AdminUserView> {
  const before = await getAdminUser(env.DB, env, userId);
  if (before.isBootstrapAdmin && input.isAdmin === false) {
    throw new AppError("PROTECTED_RESOURCE", "Bootstrap admin 不可透過 UI 移除 admin 權限");
  }
  const after: AdminUserView = {
    ...before,
    grants: input.grants ? normalizeRequestedGrants(input.grants, env) : before.grants,
    isAdmin: input.isAdmin ?? before.isAdmin,
    note: input.note === undefined ? before.note : input.note,
    status: input.status ?? before.status,
    updatedAt: Date.now(),
  };
  if (after.isAdmin && after.status !== "active") {
    throw new AppError("VALIDATION_ERROR", "Admin 必須維持 active 狀態");
  }
  if (
    before.isAdmin &&
    before.status === "active" &&
    (!after.isAdmin || after.status !== "active")
  ) {
    const activeAdmins = await createDb(env.DB)
      .select({ total: count() })
      .from(users)
      .where(and(eq(users.isAdmin, true), eq(users.status, "active")));
    if ((activeAdmins[0]?.total ?? 0) <= 1) {
      throw new AppError("CONFLICT", "不能移除或停權最後一位 active admin");
    }
  }

  const now = Date.now();
  const statements: D1PreparedStatement[] = [
    env.DB
      .prepare(
        "UPDATE users SET status = ?, is_admin = ?, note = ?, updated_at = ? WHERE id = ?",
      )
      .bind(after.status, after.isAdmin ? 1 : 0, after.note, now, userId),
    env.DB.prepare("DELETE FROM namespace_grants WHERE user_id = ?").bind(userId),
    ...after.grants.map((grant) =>
      env.DB
        .prepare(
          "INSERT INTO namespace_grants (id, user_id, namespace, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(crypto.randomUUID(), userId, grant, actor.user.id, now),
    ),
    env.DB
      .prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
      .bind(now, userId),
    ...(await auditStatementsForUserUpdate(
      env.DB,
      request,
      env,
      actor,
      requestId,
      before,
      after,
    )),
  ];
  await env.DB.batch(statements);
  return after;
}

export function resolveGithubIdentityForAdmin(
  username: string,
  fetcher?: typeof fetch,
): Promise<GithubIdentity> {
  return resolvePublicGithubUser(username, fetcher);
}
