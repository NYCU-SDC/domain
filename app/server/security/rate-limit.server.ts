import { AppError } from "~/shared/lib/errors";

export type RateLimitKind = "admin" | "api" | "auth" | "cache" | "dns" | "purge-everything";

function bindingForKind(env: Env, kind: RateLimitKind): RateLimit {
	switch (kind) {
		case "admin":
			return env.ADMIN_MUTATION_RATE_LIMITER;
		case "api":
			return env.API_RATE_LIMITER;
		case "auth":
			return env.AUTH_RATE_LIMITER;
		case "cache":
			return env.CACHE_PURGE_RATE_LIMITER;
		case "dns":
			return env.DNS_MUTATION_RATE_LIMITER;
		case "purge-everything":
			return env.PURGE_EVERYTHING_RATE_LIMITER;
	}
}

export async function enforceRateLimit(env: Env, kind: RateLimitKind, actorKey: string, action?: string): Promise<void> {
	const key = action ? `${actorKey}:${action}` : actorKey;
	const { success } = await bindingForKind(env, kind).limit({ key });
	if (!success) {
		throw new AppError("RATE_LIMITED", "操作過於頻繁，請稍後再試");
	}
}
