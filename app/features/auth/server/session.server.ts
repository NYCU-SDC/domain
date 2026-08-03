import { and, eq, gt, isNull } from "drizzle-orm";

import { getAppConfig } from "~/server/config.server";
import { createDb } from "~/server/db/client.server";
import { namespaceGrants, sessions, users } from "~/server/db/schema.server";
import { clearSessionCookie, hashClientIp, hashUserAgent, parseCookies, serializeSessionCookie, SESSION_COOKIE_NAME } from "~/server/security/request.server";
import { randomToken, sha256Hex } from "~/shared/lib/crypto";
import { AppError } from "~/shared/lib/errors";

export interface SessionUser {
	readonly githubAvatarUrl: string;
	readonly githubId: string;
	readonly githubLogin: string;
	readonly githubName: string | null;
	readonly githubProfileUrl: string;
	readonly id: string;
	readonly isAdmin: boolean;
	readonly status: "active" | "pending" | "suspended";
}

export interface AuthenticatedSession {
	readonly csrfToken?: string;
	readonly expiresAt: number;
	readonly grants: string[];
	readonly id: string;
	readonly user: SessionUser;
}

export async function getAuthenticatedSession(request: Request, env: Env): Promise<AuthenticatedSession | null> {
	const token = parseCookies(request).get(SESSION_COOKIE_NAME);
	if (!token || token.length < 43 || token.length > 128) return null;
	const tokenHash = await sha256Hex(token);
	const now = Date.now();
	const db = createDb(env.DB);
	const rows = await db
		.select({
			expiresAt: sessions.expiresAt,
			githubAvatarUrl: users.githubAvatarUrl,
			githubId: users.githubId,
			githubLogin: users.githubLogin,
			githubName: users.githubName,
			githubProfileUrl: users.githubProfileUrl,
			isAdmin: users.isAdmin,
			lastSeenAt: sessions.lastSeenAt,
			sessionId: sessions.id,
			status: users.status,
			userId: users.id
		})
		.from(sessions)
		.innerJoin(users, eq(sessions.userId, users.id))
		.where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)))
		.limit(1);
	const row = rows[0];
	if (!row) return null;
	if (row.status === "suspended") {
		await db.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, row.sessionId));
		return null;
	}
	if (now - row.lastSeenAt > 5 * 60 * 1000) {
		await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.sessionId));
	}
	const grants = await db.select({ namespace: namespaceGrants.namespace }).from(namespaceGrants).where(eq(namespaceGrants.userId, row.userId));
	return {
		expiresAt: row.expiresAt,
		grants: grants.map(grant => grant.namespace),
		id: row.sessionId,
		user: {
			githubAvatarUrl: row.githubAvatarUrl,
			githubId: row.githubId,
			githubLogin: row.githubLogin,
			githubName: row.githubName,
			githubProfileUrl: row.githubProfileUrl,
			id: row.userId,
			isAdmin: row.isAdmin,
			status: row.status
		}
	};
}

export async function requireAuthenticatedSession(request: Request, env: Env): Promise<AuthenticatedSession> {
	const session = await getAuthenticatedSession(request, env);
	if (!session) throw new AppError("UNAUTHENTICATED", "請先使用 GitHub 登入");
	return session;
}

export async function requireActiveSession(request: Request, env: Env): Promise<AuthenticatedSession> {
	const session = await requireAuthenticatedSession(request, env);
	if (session.user.status !== "active") {
		throw new AppError("FORBIDDEN", "你的帳號尚未取得使用權限");
	}
	if (!session.user.isAdmin && session.grants.length === 0) {
		throw new AppError("FORBIDDEN", "你的帳號尚未取得任何 namespace 權限");
	}
	return session;
}

export async function requireAdminSession(request: Request, env: Env): Promise<AuthenticatedSession> {
	const session = await requireActiveSession(request, env);
	if (!session.user.isAdmin) throw new AppError("FORBIDDEN", "此操作只允許系統管理員");
	return session;
}

export async function createSession(userId: string, request: Request, env: Env): Promise<{ cookie: string; sessionId: string }> {
	const token = randomToken(32);
	const tokenHash = await sha256Hex(token);
	const now = Date.now();
	const maxAge = getAppConfig(env).sessionMaxAgeSeconds;
	const sessionId = crypto.randomUUID();
	await env.DB.prepare(
		`INSERT INTO sessions (
        id, user_id, token_hash, created_at, expires_at, last_seen_at,
        revoked_at, ip_hash, user_agent_hash
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`
	)
		.bind(sessionId, userId, tokenHash, now, now + maxAge * 1000, now, await hashClientIp(request, env), await hashUserAgent(request))
		.run();
	return { cookie: serializeSessionCookie(token, maxAge), sessionId };
}

export async function revokeCurrentSession(request: Request, env: Env): Promise<string | null> {
	const token = parseCookies(request).get(SESSION_COOKIE_NAME);
	if (!token) return null;
	const hash = await sha256Hex(token);
	const row = await env.DB.prepare("SELECT id FROM sessions WHERE token_hash = ? AND revoked_at IS NULL").bind(hash).first<{ id: string }>();
	if (!row) return null;
	await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(Date.now(), row.id).run();
	return row.id;
}

export async function revokeAllUserSessions(database: D1Database, userId: string, exceptSessionId?: string): Promise<number> {
	const now = Date.now();
	const statement = exceptSessionId
		? database.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL").bind(now, userId, exceptSessionId)
		: database.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(now, userId);
	const result = await statement.run();
	return result.meta.changes;
}

export { clearSessionCookie };
