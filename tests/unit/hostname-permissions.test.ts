import { describe, expect, it } from "vitest";

import { assertHostnameAccess, assertRecordAccess, canSeeRecord } from "../../app/features/dns/server/authorization.server";
import type { AppConfig } from "../../app/server/config.server";
import {
	inferRecordNamespace,
	isDeepSubdomain,
	isHostnameWithinNamespace,
	matchesNamespaceFilter,
	normalizeGrantSet,
	normalizeHostname,
	normalizeNamespaceGrant,
	resolveRelativeOwner,
	zoneRelativeName
} from "../../app/shared/lib/dns/hostname";
import { normalizeDnsMutation } from "../../app/shared/lib/dns/records";
import { AppError } from "../../app/shared/lib/errors";
import { sessionFor } from "../helpers";

const grant = "magic.nycu.club";

const config: AppConfig = {
	allowProxiedDeepSubdomains: false,
	appOrigin: "http://localhost:5173",
	bootstrapAdminGithubIds: new Set(),
	enablePurgeEverything: false,
	environment: "local",
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

	it("rejects apex, wildcard, and external namespace grants", () => {
		expect(() => normalizeNamespaceGrant("nycu.club", "nycu.club")).toThrow();
		expect(() => normalizeNamespaceGrant("*.nycu.club", "nycu.club")).toThrow();
		expect(() => normalizeNamespaceGrant("magic.example", "nycu.club")).toThrow();
	});

	it("detects first-level versus deep subdomains, including wildcard", () => {
		expect(isDeepSubdomain("magic.nycu.club", "nycu.club")).toBe(false);
		expect(isDeepSubdomain("www.magic.nycu.club", "nycu.club")).toBe(true);
		expect(isDeepSubdomain("*.magic.nycu.club", "nycu.club")).toBe(true);
	});
});

describe("root and subdomain namespaces", () => {
	it("assigns root-level names to the zone and everything else to its first-level subdomain", () => {
		expect(inferRecordNamespace("nycu.club", "nycu.club")).toBe("nycu.club");
		expect(inferRecordNamespace("_dmarc.nycu.club", "nycu.club")).toBe("nycu.club");
		expect(inferRecordNamespace("*.nycu.club", "nycu.club")).toBe("nycu.club");
		expect(inferRecordNamespace("_https._tcp.nycu.club", "nycu.club")).toBe("nycu.club");
		expect(inferRecordNamespace("test.nycu.club", "nycu.club")).toBe("test.nycu.club");
		expect(inferRecordNamespace("_acme-challenge.www.test.nycu.club", "nycu.club")).toBe("test.nycu.club");
	});

	it("filters root without swallowing subdomains", () => {
		expect(matchesNamespaceFilter("_github-challenge.nycu.club", "nycu.club", "nycu.club")).toBe(true);
		expect(matchesNamespaceFilter("test.nycu.club", "nycu.club", "nycu.club")).toBe(false);
		expect(matchesNamespaceFilter("www.test.nycu.club", "test.nycu.club", "nycu.club")).toBe(true);
	});

	it("accepts zone-relative names or pasted FQDNs inside the zone", () => {
		expect(zoneRelativeName("test", "nycu.club")).toBe("test");
		expect(zoneRelativeName("Test.nycu.club.", "nycu.club")).toBe("test");
		expect(zoneRelativeName("nycu.club", "nycu.club")).toBe("@");
		expect(zoneRelativeName("test.example.com", "nycu.club")).toBe("test.example.com");
	});

	it("resolves Name against the zone when no namespace is sent", () => {
		const txt = (name: string, namespace?: string) => normalizeDnsMutation({ content: "v=1", name, namespace, proxied: false, ttl: 1, type: "TXT" }, "nycu.club", false).hostname;
		expect(txt("@")).toBe("nycu.club");
		expect(txt("test")).toBe("test.nycu.club");
		expect(txt("_acme.test")).toBe("_acme.test.nycu.club");
		expect(txt("test.nycu.club")).toBe("test.nycu.club");
		expect(txt("@", "test.nycu.club")).toBe("test.nycu.club");
		expect(() => txt("@", "test")).toThrow(/不在 nycu\.club 內/u);
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

	it("lets only admins manage the zone root and rejects names outside the zone", () => {
		expect(assertHostnameAccess(admin, "nycu.club", config)).toBeNull();
		expect(assertHostnameAccess(admin, "_github-challenge.nycu.club", config)).toBeNull();
		expect(() => assertHostnameAccess(member, "nycu.club", config)).toThrow(/admin/u);
		expect(() => assertHostnameAccess(admin, "test", config)).toThrow(/不在 nycu\.club zone 內/u);
	});

	it("keeps protected record IDs and unsupported types unavailable to admin", () => {
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
