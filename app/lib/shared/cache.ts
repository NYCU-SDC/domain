import { z } from "zod";

import { normalizeHostname } from "./dns/hostname";
import { AppError, validationErrorFromZod } from "./errors";

export const purgeUrlsSchema = z.strictObject({
	urls: z.array(z.string().min(1).max(2048)).min(1).max(30)
});
export const purgeHostnamesSchema = z.strictObject({
	hostnames: z.array(z.string().min(1).max(253)).min(1).max(30)
});
export const purgePrefixesSchema = z.strictObject({
	prefixes: z.array(z.string().min(1).max(2048)).min(1).max(30)
});
export const purgeEverythingSchema = z.strictObject({
	confirmation: z.string()
});

function parseSchema<T>(schema: z.ZodType<T>, value: unknown): T {
	const result = schema.safeParse(value);
	if (!result.success) throw validationErrorFromZod(result.error);
	return result.data;
}

export function normalizePurgeUrls(input: unknown): string[] {
	const { urls } = parseSchema(purgeUrlsSchema, input);
	const normalized = urls.map(value => {
		let url: URL;
		try {
			url = new URL(value);
		} catch (error) {
			throw new AppError("VALIDATION_ERROR", `URL 格式不正確：${value}`, { cause: error });
		}
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			throw new AppError("VALIDATION_ERROR", "Cache purge URL 只允許 http: 或 https:");
		}
		if (url.username || url.password) {
			throw new AppError("VALIDATION_ERROR", "Cache purge URL 不可包含 credentials");
		}
		normalizeHostname(url.hostname, { allowUnderscore: false, allowWildcard: false });
		return url.toString();
	});
	return [...new Set(normalized)];
}

export function normalizePurgeHostnames(input: unknown): string[] {
	const { hostnames } = parseSchema(purgeHostnamesSchema, input);
	return [...new Set(hostnames.map(hostname => normalizeHostname(hostname, { allowUnderscore: false, allowWildcard: false })))];
}

export interface NormalizedPrefix {
	readonly hostname: string;
	readonly prefix: string;
}

export function normalizePurgePrefixes(input: unknown): NormalizedPrefix[] {
	const { prefixes } = parseSchema(purgePrefixesSchema, input);
	const normalized = prefixes.map(value => {
		if (/^[a-z][a-z\d+.-]*:/iu.test(value) || /%(?:25|2e|2f|5c)/iu.test(value) || value.includes("\\")) {
			throw new AppError("VALIDATION_ERROR", "Prefix 請使用 hostname/path 格式，且不可包含 encoded traversal");
		}
		const firstSlash = value.indexOf("/");
		const rawPath = firstSlash === -1 ? "" : value.slice(firstSlash);
		let decodedRawPath: string;
		try {
			decodedRawPath = decodeURIComponent(rawPath);
		} catch (error) {
			throw new AppError("VALIDATION_ERROR", `Prefix path encoding 不正確：${value}`, {
				cause: error
			});
		}
		if (decodedRawPath.split("/").some(segment => segment === ".." || segment === ".")) {
			throw new AppError("VALIDATION_ERROR", "Prefix path 不可包含 . 或 .. traversal");
		}
		let url: URL;
		try {
			url = new URL(`https://${value}`);
		} catch (error) {
			throw new AppError("VALIDATION_ERROR", `Prefix 格式不正確：${value}`, { cause: error });
		}
		if (url.username || url.password || url.search || url.hash || url.port) {
			throw new AppError("VALIDATION_ERROR", "Prefix 不可包含 credentials、port、query 或 hash");
		}
		const decodedPath = decodeURIComponent(url.pathname);
		const hostname = normalizeHostname(url.hostname, {
			allowUnderscore: false,
			allowWildcard: false
		});
		const path = decodedPath.replace(/\/{2,}/gu, "/").replace(/\/$/u, "");
		if (!path || path === "/") {
			throw new AppError("VALIDATION_ERROR", "Prefix 必須包含非空的 path");
		}
		return { hostname, prefix: `${hostname}${path}` };
	});
	return [...new Map(normalized.map(item => [item.prefix, item])).values()];
}
