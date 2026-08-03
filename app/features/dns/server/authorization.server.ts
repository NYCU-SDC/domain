import type { AuthenticatedSession } from "~/features/auth/server/session.server";
import type { AppConfig } from "~/server/config.server";
import { isHostnameWithinNamespace, normalizeHostname } from "~/shared/lib/dns/hostname";
import { allowedDnsTypes, type AllowedDnsType } from "~/shared/lib/dns/records";
import { AppError } from "~/shared/lib/errors";

export interface RecordAuthorizationTarget {
	readonly id?: string;
	readonly name: string;
	readonly type?: string;
}

export function isProtectedHostname(hostname: string, config: AppConfig): boolean {
	const canonical = normalizeHostname(hostname, {
		allowUnderscore: true,
		allowWildcard: true
	});
	return config.protectedHostnames.has(canonical);
}

export function matchingNamespace(hostname: string, grants: readonly string[]): string | null {
	const matches = grants.filter(grant => isHostnameWithinNamespace(hostname, grant));
	matches.sort((left, right) => right.split(".").length - left.split(".").length);
	return matches[0] ?? null;
}

export function assertHostnameAccess(session: AuthenticatedSession, hostname: string, config: AppConfig): string | null {
	const canonical = normalizeHostname(hostname, {
		allowUnderscore: true,
		allowWildcard: true
	});
	if (isProtectedHostname(canonical, config)) {
		throw new AppError("PROTECTED_RESOURCE", "此 hostname 受平台保護，不能透過本平台修改");
	}
	if (canonical === config.zoneName || !canonical.endsWith(`.${config.zoneName}`)) {
		throw new AppError("FORBIDDEN", "Hostname 不屬於 nycu.club zone 的可管理子網域");
	}
	if (session.user.isAdmin) return null;
	const namespace = matchingNamespace(canonical, session.grants);
	if (!namespace) throw new AppError("FORBIDDEN", "你沒有權限管理此 hostname");
	return namespace;
}

export function assertRecordAccess(session: AuthenticatedSession, record: RecordAuthorizationTarget, config: AppConfig): string | null {
	if (record.id && config.protectedRecordIds.has(record.id)) {
		throw new AppError("PROTECTED_RESOURCE", "此 DNS record ID 受平台保護");
	}
	if (record.type && !allowedDnsTypes.includes(record.type.toUpperCase() as AllowedDnsType)) {
		throw new AppError("PROTECTED_RESOURCE", "此 DNS record type 不在平台白名單內");
	}
	return assertHostnameAccess(session, record.name, config);
}

export function canSeeRecord(session: AuthenticatedSession, record: RecordAuthorizationTarget, config: AppConfig): boolean {
	try {
		if (record.id && config.protectedRecordIds.has(record.id)) return session.user.isAdmin;
		const canonical = normalizeHostname(record.name, {
			allowUnderscore: true,
			allowWildcard: true
		});
		if (config.protectedHostnames.has(canonical)) return session.user.isAdmin;
		return session.user.isAdmin || session.grants.some(grant => isHostnameWithinNamespace(canonical, grant));
	} catch {
		return false;
	}
}

export function assertPurgeEverythingAccess(session: AuthenticatedSession, config: AppConfig, confirmation: string): void {
	if (!session.user.isAdmin) {
		throw new AppError("FORBIDDEN", "只有 admin 可以 purge everything");
	}
	if (!config.enablePurgeEverything) {
		throw new AppError("FORBIDDEN", "Purge everything 功能目前未啟用");
	}
	if (confirmation !== `PURGE ${config.zoneName}`) {
		throw new AppError("VALIDATION_ERROR", `請輸入 PURGE ${config.zoneName} 確認`);
	}
}
