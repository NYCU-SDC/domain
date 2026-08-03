import { z } from "zod";

import { AppError } from "~/shared/lib/errors";

const githubUserSchema = z.object({
	avatar_url: z.url(),
	html_url: z.url(),
	id: z.number().int().positive(),
	login: z.string().min(1).max(100),
	name: z.string().max(255).nullable()
});

export interface GithubIdentity {
	readonly avatarUrl: string;
	readonly id: string;
	readonly login: string;
	readonly name: string | null;
	readonly profileUrl: string;
}

async function fetchGithubUser(url: string, accessToken?: string, fetcher: typeof fetch = fetch): Promise<GithubIdentity> {
	const response = await fetcher(url, {
		headers: {
			Accept: "application/vnd.github+json",
			...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
			"User-Agent": "nycu-club-domain-console",
			"X-GitHub-Api-Version": "2022-11-28"
		},
		signal: AbortSignal.timeout(10_000)
	});
	if (response.status === 404) throw new AppError("NOT_FOUND", "找不到此 GitHub 使用者");
	if (response.status === 403 || response.status === 429) {
		throw new AppError("RATE_LIMITED", "GitHub API rate limit 已達上限，請稍後再試");
	}
	if (!response.ok) {
		throw new AppError("UPSTREAM_ERROR", "GitHub 暫時無法提供使用者資料");
	}
	let json: unknown;
	try {
		json = await response.json();
	} catch (error) {
		throw new AppError("UPSTREAM_ERROR", "GitHub 回傳了無法解析的資料", { cause: error });
	}
	const result = githubUserSchema.safeParse(json);
	if (!result.success) throw new AppError("UPSTREAM_ERROR", "GitHub identity 格式不完整");
	return {
		avatarUrl: result.data.avatar_url,
		id: String(result.data.id),
		login: result.data.login,
		name: result.data.name,
		profileUrl: result.data.html_url
	};
}

export function getAuthenticatedGithubIdentity(accessToken: string, fetcher?: typeof fetch): Promise<GithubIdentity> {
	return fetchGithubUser("https://api.github.com/user", accessToken, fetcher);
}

export function resolvePublicGithubUser(username: string, fetcher?: typeof fetch): Promise<GithubIdentity> {
	if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/iu.test(username)) {
		throw new AppError("VALIDATION_ERROR", "GitHub username 格式不正確");
	}
	return fetchGithubUser(`https://api.github.com/users/${encodeURIComponent(username)}`, undefined, fetcher);
}
