import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { z } from "zod";

import type { Route } from "./+types/api";
import {
  createAdminUser,
  getAdminUser,
  listAdminUsers,
  resolveGithubIdentityForAdmin,
  updateAdminUser,
} from "../lib/server/admin/users.server";
import {
  prepareAuditStatement,
  writeAuditLog,
  writeFailureAudit,
} from "../lib/server/audit/audit.server";
import {
  getAuthenticatedSession,
  requireActiveSession,
  requireAdminSession,
  requireAuthenticatedSession,
} from "../lib/server/auth/session.server";
import { CloudflareClient } from "../lib/server/cloudflare/client.server";
import { getAppConfig, requireSecret } from "../lib/server/config.server";
import { createDb } from "../lib/server/db/client.server";
import { auditLogs, sessions, users } from "../lib/server/db/schema.server";
import {
  assertHostnameAccess,
  assertPurgeEverythingAccess,
  assertRecordAccess,
  canSeeRecord,
  isProtectedHostname,
  matchingNamespace,
} from "../lib/server/permissions/dns-authorization.server";
import { getWorkerRuntime } from "../lib/server/runtime.server";
import {
  assertCsrfToken,
  assertSameOrigin,
  createCsrfToken,
} from "../lib/server/security/request.server";
import { enforceRateLimit, type RateLimitKind } from "../lib/server/security/rate-limit.server";
import {
  adminUsersQuerySchema,
  createUserSchema,
  resolveGithubUserSchema,
  updateUserSchema,
} from "../lib/shared/admin";
import { apiFailure, apiSuccess, assertJsonRequest } from "../lib/shared/api";
import {
  normalizePurgeHostnames,
  normalizePurgePrefixes,
  normalizePurgeUrls,
  purgeEverythingSchema,
} from "../lib/shared/cache";
import { allowedDnsTypes, normalizeDnsMutation, parseDnsRecordInput } from "../lib/shared/dns/records";
import { normalizeHostname } from "../lib/shared/dns/hostname";
import { AppError, validationErrorFromZod } from "../lib/shared/errors";

const API_PREFIX = "/api/v1";
const MAX_JSON_BODY_BYTES = 64 * 1024;
const recordIdSchema = z.string().regex(/^[a-f\d]{32}$/iu, "DNS record ID 格式不正確");
const userIdSchema = z.uuid();
const recordPathPattern = /^\/dns-records\/([a-f\d]{32})$/iu;
const adminUserPathPattern = /^\/admin\/users\/([^/]+)$/u;
const revokeSessionsPathPattern = /^\/admin\/users\/([^/]+)\/revoke-sessions$/u;
const dnsQuerySchema = z.object({
  namespace: z.string().max(253).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
  proxied: z.enum(["all", "yes", "no"]).default("all"),
  search: z.string().trim().max(200).default(""),
  type: z.enum(["all", ...allowedDnsTypes]).default("all"),
});
const auditQuerySchema = z.object({
  action: z.string().max(100).optional(),
  actor: z.string().max(100).optional(),
  from: z.coerce.number().int().positive().optional(),
  hostname: z.string().max(253).optional(),
  namespace: z.string().max(253).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
  requestId: z.string().max(100).optional(),
  status: z.enum(["success", "denied", "error"]).optional(),
  to: z.coerce.number().int().positive().optional(),
});

interface MutationAuditContext {
  action: string;
  actorUserId: string | null;
  after?: unknown;
  before?: unknown;
  hostname?: string | null;
  namespace?: string | null;
  targetId?: string | null;
  targetType?: string | null;
}

function getPath(request: Request): string {
  const pathname = new URL(request.url).pathname;
  return pathname.startsWith(API_PREFIX) ? pathname.slice(API_PREFIX.length) || "/" : pathname;
}

function queryObject(request: Request): Record<string, string> {
  return Object.fromEntries(new URL(request.url).searchParams.entries());
}

function parseWithSchema<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw validationErrorFromZod(result.error);
  return result.data;
}

async function readJsonBody(request: Request): Promise<unknown> {
  assertJsonRequest(request);
  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (declared > MAX_JSON_BODY_BYTES) {
    throw new AppError("VALIDATION_ERROR", "JSON request body 超過 64 KiB 限制", {
      httpStatus: 413,
    });
  }
  if (!request.body) throw new AppError("VALIDATION_ERROR", "缺少 JSON request body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_JSON_BODY_BYTES) {
      await reader.cancel();
      throw new AppError("VALIDATION_ERROR", "JSON request body 超過 64 KiB 限制", {
        httpStatus: 413,
      });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch (error) {
    throw new AppError("VALIDATION_ERROR", "JSON request body 無法解析", { cause: error });
  }
}

function cloudflareClient(env: Env, requestId: string): CloudflareClient {
  return new CloudflareClient({
    apiToken: requireSecret(env, "CLOUDFLARE_API_TOKEN"),
    requestId,
    zoneId: getAppConfig(env).zoneId,
  });
}

function publicRecord(
  record: Awaited<ReturnType<CloudflareClient["getDnsRecord"]>>,
  session: Awaited<ReturnType<typeof requireActiveSession>>,
  env: Env,
) {
  const config = getAppConfig(env);
  const namespace = session.user.isAdmin
    ? null
    : matchingNamespace(record.name, session.grants);
  return {
    content: record.content ?? null,
    createdOn: record.created_on ?? null,
    data: record.data ?? null,
    id: record.id,
    modifiedOn: record.modified_on ?? null,
    name: record.name,
    namespace,
    priority: record.priority ?? null,
    protected:
      config.protectedRecordIds.has(record.id) || isProtectedHostname(record.name, config),
    proxiable: record.proxiable,
    proxied: record.proxied,
    ttl: record.ttl,
    type: record.type,
  };
}

async function secureMutation(
  request: Request,
  env: Env,
  kind: RateLimitKind,
  options: { admin?: boolean; action: string },
) {
  const session = options.admin
    ? await requireAdminSession(request, env)
    : await requireActiveSession(request, env);
  assertSameOrigin(request, env);
  await assertCsrfToken(
    request.headers.get("X-CSRF-Token"),
    session.id,
    session.user.id,
    env,
  );
  await enforceRateLimit(env, kind, session.user.id, options.action);
  return session;
}

async function getAuditPage(
  request: Request,
  env: Env,
  admin: boolean,
): Promise<unknown> {
  const session = admin
    ? await requireAdminSession(request, env)
    : await requireActiveSession(request, env);
  const filters = parseWithSchema(auditQuerySchema, queryObject(request));
  const conditions = [];
  if (filters.action) conditions.push(like(auditLogs.action, `%${filters.action}%`));
  if (filters.hostname) conditions.push(like(auditLogs.hostname, `%${filters.hostname}%`));
  if (filters.namespace) conditions.push(eq(auditLogs.namespace, filters.namespace));
  if (filters.requestId) conditions.push(eq(auditLogs.requestId, filters.requestId));
  if (filters.status) conditions.push(eq(auditLogs.status, filters.status));
  if (filters.from) conditions.push(sql`${auditLogs.createdAt} >= ${filters.from}`);
  if (filters.to) conditions.push(sql`${auditLogs.createdAt} <= ${filters.to}`);
  if (filters.actor && admin) {
    conditions.push(
      or(eq(auditLogs.actorUserId, filters.actor), like(users.githubLogin, `%${filters.actor}%`)),
    );
  }
  if (!admin) {
    const namespaceCondition =
      session.grants.length > 0
        ? and(
            inArray(auditLogs.namespace, session.grants),
            or(like(auditLogs.action, "dns.%"), like(auditLogs.action, "cache.%")),
          )
        : undefined;
    conditions.push(
      namespaceCondition
        ? or(eq(auditLogs.actorUserId, session.user.id), namespaceCondition)
        : eq(auditLogs.actorUserId, session.user.id),
    );
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const db = createDb(env.DB);
  const [countRows, rows] = await Promise.all([
    db
      .select({ total: sql<number>`count(*)` })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.actorUserId, users.id))
      .where(where),
    db
      .select({
        action: auditLogs.action,
        actorLogin: users.githubLogin,
        actorUserId: auditLogs.actorUserId,
        afterJson: auditLogs.afterJson,
        beforeJson: auditLogs.beforeJson,
        createdAt: auditLogs.createdAt,
        errorCode: auditLogs.errorCode,
        errorMessage: auditLogs.errorMessage,
        hostname: auditLogs.hostname,
        id: auditLogs.id,
        namespace: auditLogs.namespace,
        requestId: auditLogs.requestId,
        status: auditLogs.status,
        targetId: auditLogs.targetId,
        targetType: auditLogs.targetType,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.actorUserId, users.id))
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(filters.perPage)
      .offset((filters.page - 1) * filters.perPage),
  ]);
  const parseSnapshot = (value: string | null): unknown => {
    if (!value) return null;
    try {
      const parsed = JSON.parse(value) as unknown;
      if (admin || !parsed || typeof parsed !== "object") return parsed;
      const redactNote = (entry: unknown): unknown => {
        if (Array.isArray(entry)) return entry.map(redactNote);
        if (entry && typeof entry === "object") {
          return Object.fromEntries(
            Object.entries(entry)
              .filter(([key]) => key !== "note")
              .map(([key, child]) => [key, redactNote(child)]),
          );
        }
        return entry;
      };
      return redactNote(parsed);
    } catch {
      return null;
    }
  };
  return {
    items: rows.map((row) => ({
      ...row,
      after: parseSnapshot(row.afterJson),
      before: parseSnapshot(row.beforeJson),
      afterJson: undefined,
      beforeJson: undefined,
    })),
    page: filters.page,
    perPage: filters.perPage,
    total: countRows[0]?.total ?? 0,
  };
}

async function dispatchGet(request: Request, env: Env, requestId: string): Promise<Response> {
  const path = getPath(request);
  const authenticated = await requireAuthenticatedSession(request, env);
  await enforceRateLimit(env, "api", authenticated.user.id, path);

  if (path === "/me") {
    return apiSuccess(
      {
        csrfToken: await createCsrfToken(authenticated.id, authenticated.user.id, env),
        grants: authenticated.grants,
        user: authenticated.user,
      },
      requestId,
    );
  }
  if (path === "/namespaces") {
    return apiSuccess({ items: authenticated.grants }, requestId);
  }
  if (path === "/sessions") {
    const rows = await createDb(env.DB)
      .select({
        createdAt: sessions.createdAt,
        expiresAt: sessions.expiresAt,
        id: sessions.id,
        lastSeenAt: sessions.lastSeenAt,
        revokedAt: sessions.revokedAt,
      })
      .from(sessions)
      .where(eq(sessions.userId, authenticated.user.id))
      .orderBy(desc(sessions.createdAt));
    return apiSuccess(
      {
        items: rows.map((session) => ({
          ...session,
          current: session.id === authenticated.id,
        })),
      },
      requestId,
    );
  }

  const active = await requireActiveSession(request, env);
  if (path === "/zone") {
    const zone = await cloudflareClient(env, requestId).getZone();
    const config = getAppConfig(env);
    return apiSuccess(
      {
        allowProxiedDeepSubdomains: config.allowProxiedDeepSubdomains,
        availableDnsTypes: allowedDnsTypes,
        canPurgeEverything: active.user.isAdmin && config.enablePurgeEverything,
        name: zone.name,
        status: zone.status,
      },
      requestId,
    );
  }
  if (path === "/dns-records") {
    const filters = parseWithSchema(dnsQuerySchema, queryObject(request));
    const config = getAppConfig(env);
    if (filters.namespace) {
      const canonical = normalizeHostname(filters.namespace);
      if (!active.user.isAdmin && !active.grants.includes(canonical)) {
        throw new AppError("FORBIDDEN", "無法查詢未授權的 namespace");
      }
    }
    const records = (await cloudflareClient(env, requestId).listDnsRecords())
      .filter((record) => canSeeRecord(active, record, config))
      .map((record) => publicRecord(record, active, env))
      .filter((record) => filters.type === "all" || record.type === filters.type)
      .filter(
        (record) =>
          filters.proxied === "all" || record.proxied === (filters.proxied === "yes"),
      )
      .filter(
        (record) =>
          !filters.namespace ||
          record.name === filters.namespace ||
          record.name.endsWith(`.${filters.namespace}`),
      )
      .filter((record) => {
        if (!filters.search) return true;
        const haystack = `${record.name} ${record.content ?? ""} ${JSON.stringify(record.data ?? {})}`.toLowerCase();
        return haystack.includes(filters.search.toLowerCase());
      });
    const start = (filters.page - 1) * filters.perPage;
    return apiSuccess(
      {
        items: records.slice(start, start + filters.perPage),
        page: filters.page,
        perPage: filters.perPage,
        total: records.length,
      },
      requestId,
    );
  }
  const recordMatch = recordPathPattern.exec(path);
  if (recordMatch?.[1]) {
    const recordId = parseWithSchema(recordIdSchema, recordMatch[1]);
    const record = await cloudflareClient(env, requestId).getDnsRecord(recordId);
    assertRecordAccess(active, record, getAppConfig(env));
    return apiSuccess(publicRecord(record, active, env), requestId);
  }
  if (path === "/audit-logs") {
    return apiSuccess(await getAuditPage(request, env, false), requestId);
  }
  if (path === "/admin/users") {
    await requireAdminSession(request, env);
    const filters = parseWithSchema(adminUsersQuerySchema, queryObject(request));
    return apiSuccess(await listAdminUsers(env.DB, env, filters), requestId);
  }
  const adminUserMatch = adminUserPathPattern.exec(path);
  if (adminUserMatch?.[1]) {
    await requireAdminSession(request, env);
    const userId = parseWithSchema(userIdSchema, adminUserMatch[1]);
    return apiSuccess(await getAdminUser(env.DB, env, userId), requestId);
  }
  if (path === "/admin/audit-logs") {
    return apiSuccess(await getAuditPage(request, env, true), requestId);
  }
  throw new AppError("NOT_FOUND", "找不到此 API endpoint");
}

function mutationAction(method: string, path: string): string | null {
  if (path === "/sessions/revoke-others") return "session.revoke";
  if (path === "/dns-records" && method === "POST") return "dns.create";
  if (/^\/dns-records\/[a-f\d]{32}$/iu.test(path)) {
    return method === "PATCH" ? "dns.update" : method === "DELETE" ? "dns.delete" : null;
  }
  if (path === "/cache/purge/urls") return "cache.purge_urls";
  if (path === "/cache/purge/hostnames") return "cache.purge_hostnames";
  if (path === "/cache/purge/prefixes") return "cache.purge_prefixes";
  if (path === "/cache/purge/everything") return "cache.purge_everything";
  if (path === "/admin/github-users/resolve") return "user.resolve";
  if (path === "/admin/users" && method === "POST") return "user.create";
  if (/^\/admin\/users\/[^/]+$/u.test(path) && method === "PATCH") return "user.update";
  if (/^\/admin\/users\/[^/]+\/revoke-sessions$/u.test(path)) return "session.revoke";
  return null;
}

async function dispatchMutation(
  request: Request,
  env: Env,
  requestId: string,
  audit: MutationAuditContext,
): Promise<Response> {
  const path = getPath(request);
  const method = request.method;

  if (path === "/sessions/revoke-others" && method === "POST") {
    const session = await secureMutation(request, env, "admin", {
      action: "revoke-others",
    });
    audit.actorUserId = session.user.id;
    await readJsonBody(request);
    const now = Date.now();
    const event = await prepareAuditStatement(env.DB, request, env, {
      action: "session.revoke",
      actorUserId: session.user.id,
      after: { exceptSessionId: session.id },
      requestId,
      status: "success",
      targetId: session.user.id,
      targetType: "user_sessions",
    });
    const results = await env.DB.batch([
      env.DB
        .prepare(
          "UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL",
        )
        .bind(now, session.user.id, session.id),
      event,
    ]);
    return apiSuccess({ revoked: results[0]?.meta.changes ?? 0 }, requestId);
  }

  if (path === "/dns-records" && method === "POST") {
    const session = await secureMutation(request, env, "dns", { action: "create" });
    audit.actorUserId = session.user.id;
    const config = getAppConfig(env);
    const normalized = normalizeDnsMutation(
      parseDnsRecordInput(await readJsonBody(request)),
      config.zoneName,
      config.allowProxiedDeepSubdomains,
    );
    audit.hostname = normalized.hostname;
    audit.namespace = normalized.namespace;
    assertHostnameAccess(session, normalized.hostname, config);
    const record = await cloudflareClient(env, requestId).createDnsRecord(normalized.payload);
    audit.after = record;
    audit.targetId = record.id;
    audit.targetType = "dns_record";
    await writeAuditLog(env.DB, request, env, { ...audit, requestId, status: "success" });
    return apiSuccess(publicRecord(record, session, env), requestId, { status: 201 });
  }

  const recordMatch = recordPathPattern.exec(path);
  if (recordMatch?.[1] && (method === "PATCH" || method === "DELETE")) {
    const session = await secureMutation(request, env, "dns", {
      action: method === "PATCH" ? "update" : "delete",
    });
    audit.actorUserId = session.user.id;
    const recordId = parseWithSchema(recordIdSchema, recordMatch[1]);
    audit.targetId = recordId;
    audit.targetType = "dns_record";
    const client = cloudflareClient(env, requestId);
    const existing = await client.getDnsRecord(recordId);
    audit.before = existing;
    audit.hostname = existing.name;
    const config = getAppConfig(env);
    audit.namespace = assertRecordAccess(session, existing, config);
    if (method === "DELETE") {
      await readJsonBody(request);
      await client.deleteDnsRecord(recordId);
      audit.after = null;
      await writeAuditLog(env.DB, request, env, { ...audit, requestId, status: "success" });
      return apiSuccess({ deletedId: recordId }, requestId);
    }
    const normalized = normalizeDnsMutation(
      parseDnsRecordInput(await readJsonBody(request)),
      config.zoneName,
      config.allowProxiedDeepSubdomains,
    );
    // Authorize both the current server-fetched name and the proposed new name.
    assertHostnameAccess(session, normalized.hostname, config);
    audit.hostname = normalized.hostname;
    audit.namespace = normalized.namespace;
    const updated = await client.updateDnsRecord(recordId, normalized.payload);
    audit.after = updated;
    await writeAuditLog(env.DB, request, env, { ...audit, requestId, status: "success" });
    return apiSuccess(publicRecord(updated, session, env), requestId);
  }

  if (path.startsWith("/cache/purge/") && method === "POST") {
    const isEverything = path === "/cache/purge/everything";
    const session = await secureMutation(
      request,
      env,
      isEverything ? "purge-everything" : "cache",
      { action: path },
    );
    audit.actorUserId = session.user.id;
    audit.targetType = "cache";
    const config = getAppConfig(env);
    const body = await readJsonBody(request);
    const client = cloudflareClient(env, requestId);
    if (path === "/cache/purge/urls") {
      const urls = normalizePurgeUrls(body);
      const namespaces = urls.map((value) => {
        const hostname = new URL(value).hostname;
        return assertHostnameAccess(session, hostname, config);
      });
      audit.after = { urls };
      audit.namespace = namespaces.find(Boolean) ?? null;
      await client.purgeUrls(urls);
    } else if (path === "/cache/purge/hostnames") {
      const hostnames = normalizePurgeHostnames(body);
      const namespaces = hostnames.map((hostname) => {
        if (hostname === config.zoneName) {
          throw new AppError("PROTECTED_RESOURCE", "不可清除 nycu.club 根網域 cache");
        }
        return assertHostnameAccess(session, hostname, config);
      });
      audit.after = { hostnames };
      audit.hostname = hostnames[0] ?? null;
      audit.namespace = namespaces.find(Boolean) ?? null;
      await client.purgeHostnames(hostnames);
    } else if (path === "/cache/purge/prefixes") {
      const prefixes = normalizePurgePrefixes(body);
      const namespaces = prefixes.map((prefix) =>
        assertHostnameAccess(session, prefix.hostname, config),
      );
      audit.after = { prefixes: prefixes.map((prefix) => prefix.prefix) };
      audit.hostname = prefixes[0]?.hostname ?? null;
      audit.namespace = namespaces.find(Boolean) ?? null;
      await client.purgePrefixes(prefixes.map((prefix) => prefix.prefix));
    } else if (isEverything) {
      const input = parseWithSchema(purgeEverythingSchema, body);
      assertPurgeEverythingAccess(session, config, input.confirmation);
      audit.after = { purgeEverything: true };
      await client.purgeEverything();
    } else {
      throw new AppError("NOT_FOUND", "找不到此 cache purge endpoint");
    }
    await writeAuditLog(env.DB, request, env, { ...audit, requestId, status: "success" });
    return apiSuccess({ purged: true }, requestId);
  }

  if (path === "/admin/github-users/resolve" && method === "POST") {
    const session = await secureMutation(request, env, "admin", {
      action: "github-user-resolve",
      admin: true,
    });
    audit.actorUserId = session.user.id;
    const input = parseWithSchema(resolveGithubUserSchema, await readJsonBody(request));
    const identity = await resolveGithubIdentityForAdmin(input.username);
    audit.after = { githubId: identity.id, login: identity.login };
    audit.targetId = identity.id;
    audit.targetType = "github_identity";
    await writeAuditLog(env.DB, request, env, { ...audit, requestId, status: "success" });
    return apiSuccess(identity, requestId);
  }

  if (path === "/admin/users" && method === "POST") {
    const session = await secureMutation(request, env, "admin", {
      action: "user-create",
      admin: true,
    });
    audit.actorUserId = session.user.id;
    const input = parseWithSchema(createUserSchema, await readJsonBody(request));
    const user = await createAdminUser(input, request, env, session, requestId);
    audit.targetId = user.id;
    return apiSuccess(user, requestId, { status: 201 });
  }

  const adminUserMatch = adminUserPathPattern.exec(path);
  if (adminUserMatch?.[1] && method === "PATCH") {
    const session = await secureMutation(request, env, "admin", {
      action: "user-update",
      admin: true,
    });
    audit.actorUserId = session.user.id;
    const userId = parseWithSchema(userIdSchema, adminUserMatch[1]);
    audit.targetId = userId;
    audit.targetType = "user";
    const input = parseWithSchema(updateUserSchema, await readJsonBody(request));
    const user = await updateAdminUser(userId, input, request, env, session, requestId);
    return apiSuccess({ ...user, requiresReauthentication: true }, requestId);
  }

  const revokeMatch = revokeSessionsPathPattern.exec(path);
  if (revokeMatch?.[1] && method === "POST") {
    const session = await secureMutation(request, env, "admin", {
      action: "revoke-sessions",
      admin: true,
    });
    audit.actorUserId = session.user.id;
    const userId = parseWithSchema(userIdSchema, revokeMatch[1]);
    audit.targetId = userId;
    audit.targetType = "user_sessions";
    await getAdminUser(env.DB, env, userId);
    await readJsonBody(request);
    const now = Date.now();
    const log = await prepareAuditStatement(env.DB, request, env, {
      action: "session.revoke",
      actorUserId: session.user.id,
      after: { userId },
      requestId,
      status: "success",
      targetId: userId,
      targetType: "user_sessions",
    });
    const result = await env.DB.batch([
      env.DB
        .prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
        .bind(now, userId),
      log,
    ]);
    return apiSuccess({ revoked: result[0]?.meta.changes ?? 0 }, requestId);
  }

  throw new AppError("NOT_FOUND", "找不到此 mutation endpoint");
}

export async function loader({ context, request }: Route.LoaderArgs): Promise<Response> {
  const { env, requestId } = getWorkerRuntime(context);
  if (request.method !== "GET") {
    return apiFailure(
      new AppError("VALIDATION_ERROR", "此 endpoint 不支援該 HTTP method", { httpStatus: 405 }),
      requestId,
    );
  }
  try {
    return await dispatchGet(request, env, requestId);
  } catch (error) {
    return apiFailure(error, requestId);
  }
}

export async function action({ context, request }: Route.ActionArgs): Promise<Response> {
  const { env, requestId } = getWorkerRuntime(context);
  const path = getPath(request);
  const actionName = mutationAction(request.method, path);
  if (!actionName) {
    return apiFailure(
      new AppError("NOT_FOUND", "找不到此 API endpoint 或 HTTP method"),
      requestId,
    );
  }
  const audit: MutationAuditContext = {
    action: actionName,
    actorUserId: null,
  };
  try {
    return await dispatchMutation(request, env, requestId, audit);
  } catch (error) {
    if (!audit.actorUserId) {
      try {
        audit.actorUserId = (await getAuthenticatedSession(request, env))?.user.id ?? null;
      } catch {
        audit.actorUserId = null;
      }
    }
    await writeFailureAudit(
      env.DB,
      request,
      env,
      { ...audit, requestId },
      error,
    );
    return apiFailure(error, requestId);
  }
}
