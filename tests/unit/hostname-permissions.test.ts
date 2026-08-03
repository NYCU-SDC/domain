import { describe, expect, it } from "vitest";

import { assertHostnameAccess, assertRecordAccess, canSeeRecord } from "../../app/features/dns/server/authorization.server";
import type { AppConfig } from "../../app/server/config.server";
import { isDeepSubdomain, isHostnameWithinNamespace, normalizeGrantSet, normalizeHostname, normalizeNamespaceGrant, resolveRelativeOwner } from "../../app/shared/lib/dns/hostname";
import { AppError } from "../../app/shared/lib/errors";
import { sessionFor } from "../helpers";

const grant = "magic.nycu.club";

const config: AppConfig = {
	allowProxiedDeepSubdomains: false,
	appOrigin: "http://localhost:5173",
	bootstrapAdminGithubIds: new Set(),
	enablePurgeEverything: false,
	environment: "local",
	protectedHostnames: new Set(["nycu.club", "api.nycu.club"]),
	protectedRecordIds: new Set(["protected-record-id"]),
	sessionMaxAgeSeconds: 604_800,
	zoneId: "zone-id",
	zoneName: "nycu.club"
};

describe("DNS label boundary authorization", () => {
	it.each(["magic.nycu.club", "www.magic.nycu.club", "api.dev.magic.nycu.club", "*.magic.nycu.club", "_acme-challenge.magic.nycu.club", "MAGIC.NYCU.CLUB", "www.magic.nycu.club."])(
		"allows %s",
		hostname => {
			expect(isHostnameWithinNamespace(hostname, grant)).toBe(true);
		}
	);

	it.each(["nycu.club", "evilmagic.nycu.club", "magic.nycu.club.evil.example", "photo.nycu.club", "magic..nycu.club", "foo*magic.nycu.club", "%2e.magic.nycu.club", "https://magic.nycu.club"])(
		"rejects %s",
		hostname => {
			expect(isHostnameWithinNamespace(hostname, grant)).toBe(false);
		}
	);

	it("canonicalizes Unicode IDNA and equivalent Punycode", () => {
		const unicode = normalizeHostname("mágic.nycu.club");
		expect(unicode).toBe("xn--mgic-5na.nycu.club");
		expect(isHostnameWithinNamespace("www.mágic.nycu.club", unicode)).toBe(true);
		expect(normalizeHostname("XN--MGIC-5NA.NYCU.CLUB.")).toBe(unicode);
	});

	it("allows valid underscore and wildcard labels only when explicitly enabled", () => {
		expect(normalizeHostname("_acme-challenge.magic.nycu.club", { allowUnderscore: true })).toBe("_acme-challenge.magic.nycu.club");
		expect(normalizeHostname("*.magic.nycu.club", { allowWildcard: true })).toBe("*.magic.nycu.club");
		expect(() => normalizeHostname("_acme.magic.nycu.club")).toThrow(AppError);
		expect(() => normalizeHostname("foo.*.magic.nycu.club", { allowWildcard: true })).toThrow(/最左側/u);
	});

	it("enforces label and FQDN length limits", () => {
		expect(() => normalizeHostname(`${"a".repeat(64)}.nycu.club`)).toThrow(/63/u);
		const tooLong = `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}`;
		expect(() => normalizeHostname(tooLong)).toThrow(/253/u);
		expect(normalizeHostname(`${"a".repeat(63)}.${"b".repeat(63)}.nycu.club`).length).toBeLessThanOrEqual(253);
	});

	it("resolves only safe relative owner names", () => {
		expect(resolveRelativeOwner("@", grant)).toBe(grant);
		expect(resolveRelativeOwner("www", grant)).toBe(`www.${grant}`);
		expect(resolveRelativeOwner("*.dev", grant)).toBe(`*.dev.${grant}`);
		expect(() => resolveRelativeOwner("www.", grant)).toThrow(/trailing dot/u);
		expect(() => resolveRelativeOwner("..", grant)).toThrow(AppError);
	});

	it("normalizes overlapping grants to the broadest safe namespace", () => {
		expect(normalizeGrantSet(["www.magic.nycu.club", grant, grant, "photo.nycu.club"])).toEqual([grant, "photo.nycu.club"]);
	});

	it("rejects apex, wildcard, external, and protected namespace grants", () => {
		expect(() => normalizeNamespaceGrant("nycu.club", "nycu.club", new Set())).toThrow();
		expect(() => normalizeNamespaceGrant("*.nycu.club", "nycu.club", new Set())).toThrow();
		expect(() => normalizeNamespaceGrant("magic.example", "nycu.club", new Set())).toThrow();
		expect(() => normalizeNamespaceGrant("api.nycu.club", "nycu.club", config.protectedHostnames)).toThrow(/保護/u);
	});

	it("detects first-level versus deep subdomains, including wildcard", () => {
		expect(isDeepSubdomain("magic.nycu.club", "nycu.club")).toBe(false);
		expect(isDeepSubdomain("www.magic.nycu.club", "nycu.club")).toBe(true);
		expect(isDeepSubdomain("*.magic.nycu.club", "nycu.club")).toBe(true);
	});
});

describe("record authorization and IDOR guard primitives", () => {
	const member = sessionFor("member", { grants: [grant] });
	const admin = sessionFor("admin", { isAdmin: true });

	it("authorizes a member only inside the DNS label boundary", () => {
		expect(assertHostnameAccess(member, "www.magic.nycu.club", config)).toBe(grant);
		expect(() => assertHostnameAccess(member, "evilmagic.nycu.club", config)).toThrow(/權限/u);
		expect(() => assertHostnameAccess(member, "photo.nycu.club", config)).toThrow(/權限/u);
	});

	it("keeps protected names, record IDs, and unsupported types unavailable to admin", () => {
		expect(() => assertHostnameAccess(admin, "api.nycu.club", config)).toThrow(/保護/u);
		expect(() =>
			assertRecordAccess(
				admin,
				{
					id: "protected-record-id",
					name: "magic.nycu.club",
					type: "A"
				},
				config
			)
		).toThrow(/record ID/u);
		expect(() =>
			assertRecordAccess(
				admin,
				{
					id: "safe-id",
					name: "magic.nycu.club",
					type: "NS"
				},
				config
			)
		).toThrow(/白名單/u);
	});

	it("uses the server-fetched current record name for IDOR checks", () => {
		expect(() =>
			assertRecordAccess(
				member,
				{
					id: "guessed-record-id",
					name: "photo.nycu.club",
					type: "A"
				},
				config
			)
		).toThrow(/權限/u);
		expect(canSeeRecord(member, { name: "api.magic.nycu.club", type: "AAAA" }, config)).toBe(true);
		expect(canSeeRecord(member, { name: "photo.nycu.club", type: "AAAA" }, config)).toBe(false);
	});
});
