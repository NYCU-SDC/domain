import { constantTimeEqual, hmacSha256Hex, sha256Hex } from "../../shared/crypto";
import { AppError } from "../../shared/errors";
import { getAppConfig, requireSecret } from "../config.server";

export const SESSION_COOKIE_NAME = "__Host-nycu_session";

export function parseCookies(request: Request): ReadonlyMap<string, string> {
	const values = new Map<string, string>();
	const header = request.headers.get("Cookie") ?? "";
	for (const pair of header.split(";")) {
		const separator = pair.indexOf("=");
		if (separator < 1) continue;
		const name = pair.slice(0, separator).trim();
		const value = pair.slice(separator + 1).trim();
		try {
			values.set(name, decodeURIComponent(value));
		} catch {
			// Ignore malformed, attacker-controlled cookie values.
		}
	}
	return values;
}

export function serializeSessionCookie(token: string, maxAge: number): string {
	return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Lax`;
}

export function clearSessionCookie(): string {
	return `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`;
}

export function getClientIp(request: Request): string {
	return request.headers.get("CF-Connecting-IP")?.trim() ?? "unknown";
}

export async function hashClientIp(request: Request, env: Env): Promise<string> {
	return hmacSha256Hex(requireSecret(env, "IP_HASH_SECRET"), getClientIp(request));
}

export async function hashUserAgent(request: Request): Promise<string> {
	return sha256Hex(request.headers.get("User-Agent") ?? "unknown");
}

export function summarizeUserAgent(request: Request): string {
	const value = (request.headers.get("User-Agent") ?? "unknown").replace(/\s+/gu, " ").trim();
	return value.slice(0, 180);
}

export function assertSameOrigin(request: Request, env: Env): void {
	const origin = request.headers.get("Origin");
	const { appOrigin } = getAppConfig(env);
	if (!origin || origin !== appOrigin) {
		throw new AppError("FORBIDDEN", "拒絕跨來源 mutation request");
	}
	const fetchSite = request.headers.get("Sec-Fetch-Site");
	if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
		throw new AppError("FORBIDDEN", "請求不是由本站發出");
	}
}

export async function readUrlEncodedForm(request: Request, maxBytes = 32_768): Promise<Record<string, string>> {
	const contentType = request.headers.get("Content-Type")?.toLowerCase() ?? "";
	if (!contentType.startsWith("application/x-www-form-urlencoded")) {
		throw new AppError("VALIDATION_ERROR", "表單只接受 application/x-www-form-urlencoded", { httpStatus: 415 });
	}
	const declaredLength = Number(request.headers.get("Content-Length") ?? 0);
	if (declaredLength > maxBytes) {
		throw new AppError("VALIDATION_ERROR", "表單內容過大", { httpStatus: 413 });
	}
	if (!request.body) throw new AppError("VALIDATION_ERROR", "缺少表單內容");

	const chunks: Uint8Array[] = [];
	const reader = request.body.getReader();
	let totalBytes = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		totalBytes += value.byteLength;
		if (totalBytes > maxBytes) {
			await reader.cancel();
			throw new AppError("VALIDATION_ERROR", "表單內容過大", { httpStatus: 413 });
		}
		chunks.push(value);
	}

	const bytes = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	const values: Record<string, string> = {};
	for (const [key, value] of new URLSearchParams(new TextDecoder().decode(bytes))) {
		if (Object.hasOwn(values, key)) {
			throw new AppError("VALIDATION_ERROR", `欄位 ${key} 不可重複`);
		}
		values[key] = value;
	}
	return values;
}

export async function createCsrfToken(sessionId: string, userId: string, env: Env): Promise<string> {
	return hmacSha256Hex(requireSecret(env, "AUTH_SECRET"), `csrf:v1:${sessionId}:${userId}`);
}

export async function assertCsrfToken(provided: string | null, sessionId: string, userId: string, env: Env): Promise<void> {
	if (!provided) throw new AppError("FORBIDDEN", "缺少 CSRF token");
	const expected = await createCsrfToken(sessionId, userId, env);
	if (!(await constantTimeEqual(provided, expected))) {
		throw new AppError("FORBIDDEN", "CSRF token 驗證失敗");
	}
}
