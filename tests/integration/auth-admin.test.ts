import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

import { createAdminUser, updateAdminUser } from "../../app/lib/server/admin/users.server";
import { createGithubAuthorization, exchangeGithubCode, readGithubCallback, upsertGithubLogin } from "../../app/lib/server/auth/oauth.server";
import { createSession, getAuthenticatedSession, requireAdminSession, revokeCurrentSession } from "../../app/lib/server/auth/session.server";
import { assertPurgeEverythingAccess } from "../../app/lib/server/permissions/dns-authorization.server";
import { enforceRateLimit } from "../../app/lib/server/security/rate-limit.server";
import { decryptJson, encryptJson, sha256Base64Url, sha256Hex } from "../../app/lib/shared/crypto";
import { AppError } from "../../app/lib/shared/errors";
import { addGrant, insertTestUser, sessionFor, testRequest } from "../helpers";

function cookieHeader(cookie: string): string {
	return cookie.split(";")[0] ?? cookie;
}

function oauthCookieValue(cookie: string): string {
	const pair = cookieHeader(cookie);
	return decodeURIComponent(pair.slice(pair.indexOf("=") + 1));
}

function authenticatedRequest(cookie: string): Request {
	return testRequest("/dashboard", { headers: { Cookie: cookieHeader(cookie) } });
}

const githubIdentity = {
	avatarUrl: "https://avatars.githubusercontent.com/u/4242",
	id: "4242",
	login: "magician123",
	name: "Magic User",
	profileUrl: "https://github.com/magician123"
};

const githubOAuthFetch: typeof fetch = vi.fn(async (input, init) => {
	const url = String(input);
	if (url.includes("/login/oauth/access_token")) {
		const body = JSON.parse(String(init?.body)) as { code_verifier?: string };
		if (!body.code_verifier) return Response.json({ error: "invalid_grant" }, { status: 400 });
		return Response.json({ access_token: "ephemeral-test-access-token", token_type: "bearer" });
	}
	if (url === "https://api.github.com/user") {
		expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer ephemeral-test-access-token");
		return Response.json({
			avatar_url: githubIdentity.avatarUrl,
			html_url: githubIdentity.profileUrl,
			id: Number(githubIdentity.id),
			login: githubIdentity.login,
			name: githubIdentity.name
		});
	}
	throw new Error(`Unexpected GitHub URL: ${url}`);
});

describe("GitHub OAuth authorization code, state, and PKCE", () => {
	it("creates unpredictable state and an S256 challenge in a short-lived callback cookie", async () => {
		const auth = await createGithubAuthorization(testRequest("/auth/github"), env);
		const url = new URL(auth.authorizationUrl);
		const state = url.searchParams.get("state");
		const challenge = url.searchParams.get("code_challenge");
		expect(state?.length).toBeGreaterThanOrEqual(43);
		expect(url.searchParams.get("code_challenge_method")).toBe("S256");
		expect(url.searchParams.get("scope")).toBeNull();
		expect(auth.cookie).toContain("HttpOnly");
		expect(auth.cookie).toContain("Secure");
		expect(auth.cookie).toContain("SameSite=Lax");
		expect(auth.cookie).toContain("Path=/auth/github/callback");
		expect(auth.cookie).toContain("Max-Age=600");

		const payload = (await decryptJson(oauthCookieValue(auth.cookie), env.AUTH_SECRET)) as {
			expiresAt: number;
			state: string;
			verifier: string;
		};
		expect(payload.state).toBe(state);
		expect(await sha256Base64Url(payload.verifier)).toBe(challenge);
		expect(payload.expiresAt).toBeGreaterThan(Date.now());
	});

	it("rejects state mismatch before exchanging a code", async () => {
		const auth = await createGithubAuthorization(testRequest("/auth/github"), env);
		const request = testRequest(`/auth/github/callback?code=test&state=${"x".repeat(43)}`, {
			headers: { Cookie: cookieHeader(auth.cookie) }
		});
		await expect(readGithubCallback(request, env, githubOAuthFetch)).rejects.toThrow(/state/u);
		expect(githubOAuthFetch).not.toHaveBeenCalled();
	});

	it("rejects expired OAuth temporary state", async () => {
		const state = "s".repeat(43);
		const verifier = "v".repeat(64);
		const expiresAt = Date.now() - 1;
		await env.DB.prepare("INSERT INTO oauth_states (id, state_hash, created_at, expires_at, consumed_at) VALUES (?, ?, ?, ?, NULL)")
			.bind(crypto.randomUUID(), await sha256Hex(state), expiresAt - 600_000, expiresAt)
			.run();
		const encrypted = await encryptJson({ expiresAt, state, verifier }, env.AUTH_SECRET);
		const request = testRequest(`/auth/github/callback?code=test&state=${state}`, {
			headers: { Cookie: `nycu_oauth_tmp=${encodeURIComponent(encrypted)}` }
		});
		await expect(readGithubCallback(request, env, githubOAuthFetch)).rejects.toThrow(/超過 10 分鐘/u);
	});

	it("atomically consumes state and rejects callback replay", async () => {
		const auth = await createGithubAuthorization(testRequest("/auth/github"), env);
		const state = new URL(auth.authorizationUrl).searchParams.get("state");
		expect(state).not.toBeNull();
		const request = testRequest(`/auth/github/callback?code=test-code&state=${state ?? ""}`, {
			headers: { Cookie: cookieHeader(auth.cookie) }
		});
		await expect(readGithubCallback(request, env, githubOAuthFetch)).resolves.toEqual(githubIdentity);
		await expect(readGithubCallback(request, env, githubOAuthFetch)).rejects.toThrow(/已使用/u);
	});

	it("sends the PKCE verifier and safely handles an upstream verifier rejection", async () => {
		const rejectingFetch: typeof fetch = async (_input, init) => {
			const body = JSON.parse(String(init?.body)) as { code_verifier?: string };
			expect(body.code_verifier).toBe("wrong-verifier-value-with-sufficient-length-1234567890");
			return Response.json({ error: "incorrect_code_verifier" });
		};
		await expect(exchangeGithubCode("code", "wrong-verifier-value-with-sufficient-length-1234567890", env, rejectingFetch)).rejects.toThrow(/authorization code/u);
	});
});

describe("numeric GitHub identity status and bootstrap behavior", () => {
	it("creates unknown users as pending without grants", async () => {
		const result = await upsertGithubLogin(githubIdentity, env);
		expect(result.userStatus).toBe("pending");
		expect(result.userId).toBeTruthy();
		const grants = await env.DB.prepare("SELECT namespace FROM namespace_grants WHERE user_id = ?").bind(result.userId).all();
		expect(grants.results).toHaveLength(0);
	});

	it("updates a renamed login while retaining the numeric identity", async () => {
		const first = await upsertGithubLogin(githubIdentity, env);
		const second = await upsertGithubLogin({ ...githubIdentity, login: "renamed-magician" }, env);
		expect(second.userId).toBe(first.userId);
		const row = await env.DB.prepare("SELECT github_login AS login FROM users WHERE github_id = ?").bind(githubIdentity.id).first<{ login: string }>();
		expect(row?.login).toBe("renamed-magician");
	});

	it("activates immutable numeric bootstrap admins", async () => {
		const result = await upsertGithubLogin({ ...githubIdentity, id: "9001" }, env);
		expect(result).toMatchObject({ isBootstrapAdmin: true, userStatus: "active" });
		const row = await env.DB.prepare("SELECT is_admin AS isAdmin, status FROM users WHERE github_id = '9001'").first<{ isAdmin: number; status: string }>();
		expect(row).toEqual({ isAdmin: 1, status: "active" });
	});

	it("preserves suspended status and does not create a general session during identity update", async () => {
		await insertTestUser({ githubId: githubIdentity.id, status: "suspended" });
		const result = await upsertGithubLogin(githubIdentity, env);
		expect(result.userStatus).toBe("suspended");
		const sessionCount = await env.DB.prepare("SELECT COUNT(*) AS total FROM sessions").first<{ total: number }>();
		expect(sessionCount?.total).toBe(0);
	});
});

describe("opaque server-side sessions", () => {
	it("stores only a SHA-256 token hash and authenticates the original cookie", async () => {
		const userId = await insertTestUser();
		await addGrant(userId, "magic.nycu.club");
		const created = await createSession(userId, testRequest("/auth/github/callback"), env);
		const rawToken = decodeURIComponent(cookieHeader(created.cookie).split("=")[1] ?? "");
		const row = await env.DB.prepare("SELECT token_hash AS tokenHash FROM sessions WHERE id = ?").bind(created.sessionId).first<{ tokenHash: string }>();
		expect(rawToken.length).toBeGreaterThanOrEqual(43);
		expect(row?.tokenHash).toBe(await sha256Hex(rawToken));
		expect(row?.tokenHash).not.toContain(rawToken);
		await expect(getAuthenticatedSession(authenticatedRequest(created.cookie), env)).resolves.toMatchObject({ id: created.sessionId, grants: ["magic.nycu.club"] });
	});

	it("rejects expired and revoked sessions", async () => {
		const userId = await insertTestUser();
		const expired = await createSession(userId, testRequest(), env);
		await env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?")
			.bind(Date.now() - 1, expired.sessionId)
			.run();
		await expect(getAuthenticatedSession(authenticatedRequest(expired.cookie), env)).resolves.toBeNull();

		const revoked = await createSession(userId, testRequest(), env);
		await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?").bind(Date.now(), revoked.sessionId).run();
		await expect(getAuthenticatedSession(authenticatedRequest(revoked.cookie), env)).resolves.toBeNull();
	});

	it("revokes the current session on logout logic", async () => {
		const userId = await insertTestUser();
		const created = await createSession(userId, testRequest(), env);
		await expect(revokeCurrentSession(authenticatedRequest(created.cookie), env)).resolves.toBe(created.sessionId);
		await expect(getAuthenticatedSession(authenticatedRequest(created.cookie), env)).resolves.toBeNull();
	});

	it("revokes a suspended user's session on the next authenticated request", async () => {
		const userId = await insertTestUser();
		const created = await createSession(userId, testRequest(), env);
		await env.DB.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").bind(userId).run();
		await expect(getAuthenticatedSession(authenticatedRequest(created.cookie), env)).resolves.toBeNull();
		const row = await env.DB.prepare("SELECT revoked_at AS revokedAt FROM sessions WHERE id = ?").bind(created.sessionId).first<{ revokedAt: number | null }>();
		expect(row?.revokedAt).not.toBeNull();
	});
});

describe("admin safety and session revocation", () => {
	it("denies a regular user access to admin authorization", async () => {
		const userId = await insertTestUser({ isAdmin: false });
		await addGrant(userId, "magic.nycu.club");
		const created = await createSession(userId, testRequest(), env);
		await expect(requireAdminSession(authenticatedRequest(created.cookie), env)).rejects.toThrow(/管理員/u);
	});

	it("prevents removal or suspension of the last active admin", async () => {
		const adminId = await insertTestUser({ isAdmin: true });
		const actor = sessionFor(adminId, { isAdmin: true });
		await expect(updateAdminUser(adminId, { isAdmin: false }, testRequest(), env, actor, "req-last-admin")).rejects.toThrow(/最後一位/u);
		await expect(updateAdminUser(adminId, { status: "suspended" }, testRequest(), env, actor, "req-last-admin-2")).rejects.toThrow(/active/u);
	});

	it("revokes all target sessions when grants, note, status, or admin state changes", async () => {
		const adminId = await insertTestUser({ isAdmin: true });
		const targetId = await insertTestUser({ note: "old note" });
		const targetSession = await createSession(targetId, testRequest(), env);
		const actor = sessionFor(adminId, { isAdmin: true });
		await updateAdminUser(targetId, { grants: ["magic.nycu.club", "www.magic.nycu.club"], note: "魔術社社長" }, testRequest(), env, actor, "req-grant-update");
		const sessionRow = await env.DB.prepare("SELECT revoked_at AS revokedAt FROM sessions WHERE id = ?").bind(targetSession.sessionId).first<{ revokedAt: number | null }>();
		expect(sessionRow?.revokedAt).not.toBeNull();
		const grants = await env.DB.prepare("SELECT namespace FROM namespace_grants WHERE user_id = ? ORDER BY namespace").bind(targetId).all<{ namespace: string }>();
		expect(grants.results).toEqual([{ namespace: "magic.nycu.club" }]);
	});

	it("does not expose admin-only note in the regular session user shape", async () => {
		const userId = await insertTestUser({ note: "private admin note" });
		await addGrant(userId, "magic.nycu.club");
		const created = await createSession(userId, testRequest(), env);
		const session = await getAuthenticatedSession(authenticatedRequest(created.cookie), env);
		expect(JSON.stringify(session)).not.toContain("private admin note");
		expect(session?.user).not.toHaveProperty("note");
	});

	it("rejects duplicate GitHub numeric IDs when admin resolves by username", async () => {
		const adminId = await insertTestUser({ isAdmin: true });
		await insertTestUser({ githubId: "777", login: "existing" });
		const fetcher: typeof fetch = async () =>
			Response.json({
				avatar_url: "https://avatars.githubusercontent.com/u/777",
				html_url: "https://github.com/existing",
				id: 777,
				login: "existing",
				name: "Existing"
			});
		await expect(
			createAdminUser({ grants: [], isAdmin: false, note: null, status: "pending", username: "existing" }, testRequest(), env, sessionFor(adminId, { isAdmin: true }), "req-duplicate", fetcher)
		).rejects.toThrow(/已存在/u);
	});

	it("forces a pre-created bootstrap identity to active admin", async () => {
		const adminId = await insertTestUser({ isAdmin: true });
		const fetcher: typeof fetch = async () =>
			Response.json({
				avatar_url: "https://avatars.githubusercontent.com/u/9001",
				html_url: "https://github.com/bootstrap-user",
				id: 9001,
				login: "bootstrap-user",
				name: "Bootstrap User"
			});
		const created = await createAdminUser(
			{ grants: [], isAdmin: false, note: null, status: "pending", username: "bootstrap-user" },
			testRequest(),
			env,
			sessionFor(adminId, { isAdmin: true }),
			"req-bootstrap-create",
			fetcher
		);
		expect(created).toMatchObject({
			isAdmin: true,
			isBootstrapAdmin: true,
			status: "active"
		});
	});
});

describe("cache purge feature gates and rate limiting", () => {
	const baseConfig = {
		allowProxiedDeepSubdomains: false,
		appOrigin: "http://localhost:5173",
		bootstrapAdminGithubIds: new Set<string>(),
		enablePurgeEverything: false,
		environment: "local" as const,
		protectedHostnames: new Set<string>(),
		protectedRecordIds: new Set<string>(),
		sessionMaxAgeSeconds: 604_800,
		zoneId: "zone",
		zoneName: "nycu.club"
	};

	it("requires admin, feature flag, and exact destructive confirmation", () => {
		expect(() => assertPurgeEverythingAccess(sessionFor("member"), baseConfig, "PURGE nycu.club")).toThrow(/admin/u);
		expect(() => assertPurgeEverythingAccess(sessionFor("admin", { isAdmin: true }), baseConfig, "PURGE nycu.club")).toThrow(/未啟用/u);
		const enabled = { ...baseConfig, enablePurgeEverything: true };
		expect(() => assertPurgeEverythingAccess(sessionFor("admin", { isAdmin: true }), enabled, "purge")).toThrow(/PURGE nycu.club/u);
		expect(() => assertPurgeEverythingAccess(sessionFor("admin", { isAdmin: true }), enabled, "PURGE nycu.club")).not.toThrow();
	});

	it("maps a denied rate-limit binding to RATE_LIMITED", async () => {
		const deniedEnv = Object.create(env) as Env;
		Object.defineProperty(deniedEnv, "CACHE_PURGE_RATE_LIMITER", {
			value: { limit: async () => ({ success: false }) }
		});
		const error = await enforceRateLimit(deniedEnv, "cache", "user-1", "purge").catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(AppError);
		expect((error as AppError).code).toBe("RATE_LIMITED");
	});
});
