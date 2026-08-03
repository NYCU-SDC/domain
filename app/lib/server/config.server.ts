import { z } from "zod";

import { normalizeHostname } from "../shared/dns/hostname";
import { AppError } from "../shared/errors";

export interface AppConfig {
	readonly allowProxiedDeepSubdomains: boolean;
	readonly appOrigin: string;
	readonly bootstrapAdminGithubIds: ReadonlySet<string>;
	readonly enablePurgeEverything: boolean;
	readonly environment: "local" | "production" | "staging";
	readonly protectedHostnames: ReadonlySet<string>;
	readonly protectedRecordIds: ReadonlySet<string>;
	readonly sessionMaxAgeSeconds: number;
	readonly zoneId: string;
	readonly zoneName: string;
}

function parseBoolean(value: string, name: string): boolean {
	if (value === "true") return true;
	if (value === "false") return false;
	throw new AppError("INTERNAL_ERROR", `${name} 必須是 true 或 false`);
}

function parseJsonArray(value: string, name: string): string[] {
	try {
		const parsed = z.array(z.string()).parse(JSON.parse(value) as unknown);
		return parsed;
	} catch (error) {
		throw new AppError("INTERNAL_ERROR", `${name} 必須是 JSON string array`, {
			cause: error
		});
	}
}

export function getAppConfig(env: Env): AppConfig {
	const zoneName = normalizeHostname(env.CLOUDFLARE_ZONE_NAME);
	let appOrigin: string;
	try {
		const parsedOrigin = new URL(env.APP_ORIGIN);
		if (
			(parsedOrigin.protocol !== "https:" && env.ENVIRONMENT !== "local") ||
			parsedOrigin.username ||
			parsedOrigin.password ||
			parsedOrigin.pathname !== "/" ||
			parsedOrigin.search ||
			parsedOrigin.hash
		) {
			throw new Error("Origin must be a bare HTTPS origin");
		}
		appOrigin = parsedOrigin.origin;
	} catch (error) {
		throw new AppError("INTERNAL_ERROR", "APP_ORIGIN 設定不正確", { cause: error });
	}

	const protectedHostnames = new Set(parseJsonArray(env.PROTECTED_HOSTNAMES, "PROTECTED_HOSTNAMES").map(hostname => normalizeHostname(hostname, { allowUnderscore: true, allowWildcard: false })));
	const protectedRecordIds = new Set(parseJsonArray(env.PROTECTED_RECORD_IDS, "PROTECTED_RECORD_IDS"));
	const bootstrapIds = env.BOOTSTRAP_ADMIN_GITHUB_IDS.split(",")
		.map(id => id.trim())
		.filter(Boolean);
	if (bootstrapIds.some(id => !/^\d+$/u.test(id))) {
		throw new AppError("INTERNAL_ERROR", "BOOTSTRAP_ADMIN_GITHUB_IDS 只能包含逗號分隔的 GitHub numeric IDs");
	}
	const sessionMaxAgeSeconds = Number(env.SESSION_MAX_AGE_SECONDS);
	if (!Number.isSafeInteger(sessionMaxAgeSeconds) || sessionMaxAgeSeconds < 3600 || sessionMaxAgeSeconds > 2_592_000) {
		throw new AppError("INTERNAL_ERROR", "SESSION_MAX_AGE_SECONDS 超出安全範圍");
	}

	return {
		allowProxiedDeepSubdomains: parseBoolean(env.ALLOW_PROXIED_DEEP_SUBDOMAINS, "ALLOW_PROXIED_DEEP_SUBDOMAINS"),
		appOrigin,
		bootstrapAdminGithubIds: new Set(bootstrapIds),
		enablePurgeEverything: parseBoolean(env.ENABLE_PURGE_EVERYTHING, "ENABLE_PURGE_EVERYTHING"),
		environment: env.ENVIRONMENT,
		protectedHostnames,
		protectedRecordIds,
		sessionMaxAgeSeconds,
		zoneId: env.CLOUDFLARE_ZONE_ID,
		zoneName
	};
}

export function requireSecret(env: Env, name: "AUTH_SECRET" | "CLOUDFLARE_API_TOKEN" | "DISCORD_APPLICATION_WEBHOOK_URL" | "GITHUB_CLIENT_ID" | "GITHUB_CLIENT_SECRET" | "IP_HASH_SECRET"): string {
	const value = env[name];
	if (!value || value.length < (name.endsWith("SECRET") ? 32 : 1)) {
		throw new AppError("INTERNAL_ERROR", `${name} 尚未安全設定`);
	}
	return value;
}
