import { eq } from "drizzle-orm";
import { z } from "zod";

import {
  constantTimeEqual,
  decryptJson,
  encryptJson,
  randomToken,
  sha256Base64Url,
  sha256Hex,
} from "../../shared/crypto";
import { AppError } from "../../shared/errors";
import { getAppConfig, requireSecret } from "../config.server";
import { createDb } from "../db/client.server";
import { users } from "../db/schema.server";
import {
  getAuthenticatedGithubIdentity,
  type GithubIdentity,
} from "../github/client.server";
import { parseCookies } from "../security/request.server";

const OAUTH_COOKIE_NAME = "nycu_oauth_tmp";
const OAUTH_COOKIE_PATH = "/auth/github/callback";
const OAUTH_MAX_AGE_SECONDS = 600;

const oauthCookieSchema = z.strictObject({
  expiresAt: z.number().int().positive(),
  state: z.string().min(43).max(128),
  verifier: z.string().min(43).max(128),
});

const callbackQuerySchema = z.object({
  code: z.string().min(1).max(512),
  state: z.string().min(43).max(128),
});

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  scope: z.string().optional(),
  token_type: z.string().min(1),
});

export interface GithubLoginResult {
  readonly identity: GithubIdentity;
  readonly isBootstrapAdmin: boolean;
  readonly userId: string;
  readonly userStatus: "active" | "pending" | "suspended";
}

function serializeOauthCookie(value: string): string {
  return `${OAUTH_COOKIE_NAME}=${encodeURIComponent(value)}; Path=${OAUTH_COOKIE_PATH}; Max-Age=${OAUTH_MAX_AGE_SECONDS}; Secure; HttpOnly; SameSite=Lax`;
}

export function clearOauthCookie(): string {
  return `${OAUTH_COOKIE_NAME}=; Path=${OAUTH_COOKIE_PATH}; Max-Age=0; Secure; HttpOnly; SameSite=Lax`;
}

export async function createGithubAuthorization(
  request: Request,
  env: Env,
): Promise<{ authorizationUrl: string; cookie: string }> {
  const config = getAppConfig(env);
  const state = randomToken(32);
  const verifier = randomToken(64);
  const challenge = await sha256Base64Url(verifier);
  const now = Date.now();
  const expiresAt = now + OAUTH_MAX_AGE_SECONDS * 1000;
  const encryptedCookie = await encryptJson(
    { expiresAt, state, verifier },
    requireSecret(env, "AUTH_SECRET"),
  );
  await env.DB
    .prepare(
      "INSERT INTO oauth_states (id, state_hash, created_at, expires_at, consumed_at) VALUES (?, ?, ?, ?, NULL)",
    )
    .bind(crypto.randomUUID(), await sha256Hex(state), now, expiresAt)
    .run();

  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", requireSecret(env, "GITHUB_CLIENT_ID"));
  url.searchParams.set("redirect_uri", `${config.appOrigin}/auth/github/callback`);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("allow_signup", "true");
  // Intentionally do not request repository, organization, or user scopes.

  void request;
  return { authorizationUrl: url.toString(), cookie: serializeOauthCookie(encryptedCookie) };
}

async function consumeOauthState(
  request: Request,
  state: string,
  env: Env,
): Promise<string> {
  const encrypted = parseCookies(request).get(OAUTH_COOKIE_NAME);
  if (!encrypted) throw new AppError("FORBIDDEN", "OAuth 暫存資料不存在或已過期");
  let parsed: z.infer<typeof oauthCookieSchema>;
  try {
    parsed = oauthCookieSchema.parse(
      await decryptJson(encrypted, requireSecret(env, "AUTH_SECRET")),
    );
  } catch (error) {
    throw new AppError("FORBIDDEN", "OAuth 暫存資料無法驗證", { cause: error });
  }
  if (parsed.expiresAt < Date.now()) {
    throw new AppError("FORBIDDEN", "OAuth 登入流程已超過 10 分鐘，請重新登入");
  }
  if (!(await constantTimeEqual(state, parsed.state))) {
    throw new AppError("FORBIDDEN", "OAuth state 驗證失敗");
  }
  const result = await env.DB
    .prepare(
      `UPDATE oauth_states SET consumed_at = ?
       WHERE state_hash = ? AND consumed_at IS NULL AND expires_at >= ?`,
    )
    .bind(Date.now(), await sha256Hex(state), Date.now())
    .run();
  if (result.meta.changes !== 1) {
    throw new AppError("FORBIDDEN", "OAuth callback 已使用、已過期或不存在");
  }
  return parsed.verifier;
}

export async function exchangeGithubCode(
  code: string,
  verifier: string,
  env: Env,
  fetcher: typeof fetch = fetch,
): Promise<GithubIdentity> {
  const config = getAppConfig(env);
  const response = await fetcher("https://github.com/login/oauth/access_token", {
    body: JSON.stringify({
      client_id: requireSecret(env, "GITHUB_CLIENT_ID"),
      client_secret: requireSecret(env, "GITHUB_CLIENT_SECRET"),
      code,
      code_verifier: verifier,
      redirect_uri: `${config.appOrigin}/auth/github/callback`,
    }),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    method: "POST",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new AppError("UPSTREAM_ERROR", "GitHub OAuth token exchange 失敗");
  let json: unknown;
  try {
    json = await response.json();
  } catch (error) {
    throw new AppError("UPSTREAM_ERROR", "GitHub OAuth 回傳了無法解析的資料", {
      cause: error,
    });
  }
  const tokenResult = tokenResponseSchema.safeParse(json);
  if (!tokenResult.success) {
    throw new AppError("UPSTREAM_ERROR", "GitHub OAuth 拒絕了 authorization code");
  }
  // The token exists only in this call stack and is discarded immediately after /user.
  return getAuthenticatedGithubIdentity(tokenResult.data.access_token, fetcher);
}

export async function readGithubCallback(
  request: Request,
  env: Env,
  fetcher?: typeof fetch,
): Promise<GithubIdentity> {
  const url = new URL(request.url);
  if (url.searchParams.has("error")) {
    throw new AppError("FORBIDDEN", "你取消了 GitHub 授權，或 GitHub 拒絕了登入請求");
  }
  const parsed = callbackQuerySchema.safeParse({
    code: url.searchParams.get("code"),
    state: url.searchParams.get("state"),
  });
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "OAuth callback 缺少必要參數");
  const verifier = await consumeOauthState(request, parsed.data.state, env);
  return exchangeGithubCode(parsed.data.code, verifier, env, fetcher);
}

export async function upsertGithubLogin(
  identity: GithubIdentity,
  env: Env,
): Promise<GithubLoginResult> {
  const config = getAppConfig(env);
  const isBootstrapAdmin = config.bootstrapAdminGithubIds.has(identity.id);
  const db = createDb(env.DB);
  const existing = await db
    .select({ id: users.id, isAdmin: users.isAdmin, status: users.status })
    .from(users)
    .where(eq(users.githubId, identity.id))
    .limit(1);
  const now = Date.now();
  let userId = existing[0]?.id;
  let userStatus = existing[0]?.status ?? (isBootstrapAdmin ? "active" : "pending");

  if (!userId) {
    userId = crypto.randomUUID();
    try {
      await db.insert(users).values({
        createdAt: now,
        githubAvatarUrl: identity.avatarUrl,
        githubId: identity.id,
        githubLogin: identity.login,
        githubName: identity.name,
        githubProfileUrl: identity.profileUrl,
        id: userId,
        isAdmin: isBootstrapAdmin,
        lastLoginAt: now,
        status: userStatus,
        updatedAt: now,
      });
    } catch {
      const raced = await db
        .select({ id: users.id, status: users.status })
        .from(users)
        .where(eq(users.githubId, identity.id))
        .limit(1);
      if (!raced[0]) throw new AppError("CONFLICT", "無法建立唯一的 GitHub identity");
      userId = raced[0].id;
      userStatus = raced[0].status;
    }
  }

  if (isBootstrapAdmin) userStatus = "active";
  await db
    .update(users)
    .set({
      githubAvatarUrl: identity.avatarUrl,
      githubLogin: identity.login,
      githubName: identity.name,
      githubProfileUrl: identity.profileUrl,
      ...(isBootstrapAdmin ? { isAdmin: true, status: "active" as const } : {}),
      lastLoginAt: now,
      updatedAt: now,
    })
    .where(eq(users.id, userId));

  return { identity, isBootstrapAdmin, userId, userStatus };
}
