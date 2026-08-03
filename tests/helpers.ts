import { env } from "cloudflare:workers";

import type { AuthenticatedSession } from "../app/features/auth/server/session.server";

export interface TestUserOptions {
	readonly githubId?: string;
	readonly id?: string;
	readonly isAdmin?: boolean;
	readonly login?: string;
	readonly note?: string | null;
	readonly status?: "active" | "pending" | "suspended";
}

export async function insertTestUser(options: TestUserOptions = {}): Promise<string> {
	const id = options.id ?? crypto.randomUUID();
	const githubId = options.githubId ?? String(10_000 + Math.floor(Math.random() * 1_000_000));
	const login = options.login ?? `user-${githubId}`;
	const now = Date.now();
	await env.DB.prepare(
		`INSERT INTO users (
      id, github_id, github_login, github_name, github_avatar_url,
      github_profile_url, status, is_admin, note, created_at, updated_at, last_login_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	)
		.bind(
			id,
			githubId,
			login,
			`Test ${login}`,
			`https://avatars.githubusercontent.com/u/${githubId}`,
			`https://github.com/${login}`,
			options.status ?? "active",
			options.isAdmin ? 1 : 0,
			options.note ?? null,
			now,
			now,
			now
		)
		.run();
	return id;
}

export async function addGrant(userId: string, namespace: string, createdByUserId = userId): Promise<void> {
	await env.DB.prepare("INSERT INTO namespace_grants (id, user_id, namespace, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?)")
		.bind(crypto.randomUUID(), userId, namespace, createdByUserId, Date.now())
		.run();
}

export function sessionFor(
	userId: string,
	options: {
		readonly grants?: string[];
		readonly isAdmin?: boolean;
		readonly status?: "active" | "pending" | "suspended";
	} = {}
): AuthenticatedSession {
	return {
		expiresAt: Date.now() + 60_000,
		grants: options.grants ?? [],
		id: crypto.randomUUID(),
		user: {
			githubAvatarUrl: "https://avatars.githubusercontent.com/u/42",
			githubId: "42",
			githubLogin: "test-user",
			githubName: "Test User",
			githubProfileUrl: "https://github.com/test-user",
			id: userId,
			isAdmin: options.isAdmin ?? false,
			status: options.status ?? "active"
		}
	};
}

export function testRequest(path = "/api/v1/test", init: RequestInit = {}): Request {
	const headers = new Headers(init.headers);
	headers.set("CF-Connecting-IP", "203.0.113.10");
	headers.set("Origin", "http://localhost:5173");
	headers.set("User-Agent", "nycu.club test agent");
	return new Request(`http://localhost:5173${path}`, { ...init, headers });
}
