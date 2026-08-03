import { describe, expect, it } from "vitest";

import { assertHostnameAccess } from "../../app/features/dns/server/authorization.server";
import type { AppConfig } from "../../app/server/config.server";
import { normalizePurgeHostnames, normalizePurgePrefixes, normalizePurgeUrls } from "../../app/shared/lib/cache";
import { normalizeDnsMutation, parseDnsRecordInput } from "../../app/shared/lib/dns/records";
import { AppError } from "../../app/shared/lib/errors";
import { sessionFor } from "../helpers";

const namespace = "magic.nycu.club";

function normalize(input: unknown, allowDeepProxy = false) {
	return normalizeDnsMutation(parseDnsRecordInput(input), "nycu.club", allowDeepProxy);
}

describe("DNS discriminated record schemas", () => {
	it.each([
		[{ content: "192.0.2.1", name: "@", namespace, proxied: true, ttl: 1, type: "A" }, "A"],
		[{ content: "2001:db8::1", name: "www", namespace, proxied: false, ttl: 300, type: "AAAA" }, "AAAA"],
		[{ name: "www", namespace, proxied: false, target: "origin.example.com.", ttl: 300, type: "CNAME" }, "CNAME"],
		[{ content: "google-site-verification=abc", name: "_verify", namespace, ttl: 1, type: "TXT" }, "TXT"],
		[{ name: "@", namespace, priority: 10, target: "mail.example.com", ttl: 300, type: "MX" }, "MX"],
		[{ name: "@", namespace, port: 443, priority: 10, protocol: "tcp", service: "https", target: "target.example.com", ttl: 300, type: "SRV", weight: 5 }, "SRV"],
		[{ flags: 0, name: "@", namespace, tag: "issue", ttl: 300, type: "CAA", value: "letsencrypt.org" }, "CAA"]
	] as const)("accepts valid %s input", (input, type) => {
		expect(normalize(input).payload.type).toBe(type);
	});

	it.each([
		{ content: "999.1.2.3", name: "@", namespace, ttl: 1, type: "A" },
		{ content: "not-ipv6", name: "@", namespace, ttl: 1, type: "AAAA" },
		{ name: "@", namespace, target: "bad target", ttl: 1, type: "CNAME" },
		{ content: "", name: "@", namespace, ttl: 1, type: "TXT" },
		{ name: "@", namespace, priority: 65_536, target: "mail.example.com", ttl: 1, type: "MX" },
		{ name: "@", namespace, port: 65_536, priority: 1, protocol: "tcp", service: "https", target: "target.example.com", ttl: 1, type: "SRV", weight: 1 },
		{ flags: 256, name: "@", namespace, tag: "issue", ttl: 1, type: "CAA", value: "ca.example" }
	])("rejects invalid per-type input", input => {
		expect(() => normalize(input)).toThrow(AppError);
	});

	it("rejects unsupported types even when the payload shape looks plausible", () => {
		expect(() => normalize({ content: "ns1.example.com", name: "@", namespace, ttl: 1, type: "NS" })).toThrow(AppError);
	});

	it("forces DNS-only types at the schema and payload boundaries", () => {
		expect(() => normalize({ name: "@", namespace, priority: 10, proxied: true, target: "mail.example.com", ttl: 1, type: "MX" })).toThrow(AppError);
		const result = normalize({ flags: 0, name: "@", namespace, proxied: false, tag: "iodef", ttl: 1, type: "CAA", value: "mailto:security@example.com" });
		expect(result.payload.proxied).toBe(false);
	});

	it("builds Cloudflare SRV and CAA data fields without a generic body", () => {
		const srv = normalize({ name: "sip", namespace, port: 5060, priority: 1, protocol: "udp", service: "sip", target: "sip.example.com", ttl: 300, type: "SRV", weight: 10 });
		expect(srv).toMatchObject({
			hostname: "_sip._udp.sip.magic.nycu.club",
			payload: { data: { name: "sip.magic.nycu.club", port: 5060, priority: 1, proto: "_udp", service: "_sip", target: "sip.example.com", weight: 10 }, proxied: false, type: "SRV" }
		});
		const caa = normalize({ flags: 0, name: "@", namespace, tag: "issuewild", ttl: 300, type: "CAA", value: ";" });
		expect(caa.payload).toMatchObject({ data: { flags: 0, tag: "issuewild", value: ";" }, type: "CAA" });
	});

	it("enforces TTL and deep-subdomain TLS proxy policy", () => {
		expect(() => normalize({ content: "192.0.2.1", name: "@", namespace, proxied: true, ttl: 300, type: "A" })).toThrow(/TTL/u);
		expect(() => normalize({ content: "192.0.2.1", name: "www", namespace, proxied: true, ttl: 1, type: "A" })).toThrow(/多層/u);
		expect(normalize({ content: "192.0.2.1", name: "www", namespace, proxied: true, ttl: 1, type: "A" }, true).payload.proxied).toBe(true);
		expect(() => normalize({ content: "192.0.2.1", name: "*", namespace, proxied: true, ttl: 1, type: "A" })).toThrow(/多層/u);
		expect(() => normalize({ content: "192.0.2.1", name: "@", namespace, ttl: 30, type: "A" })).toThrow(AppError);
	});

	it("supports relative wildcard and underscore owner names without escaping namespace", () => {
		expect(normalize({ content: "verification", name: "_acme-challenge", namespace, ttl: 1, type: "TXT" }).hostname).toBe("_acme-challenge.magic.nycu.club");
		expect(normalize({ content: "192.0.2.1", name: "*.dev", namespace, ttl: 1, type: "A" }).hostname).toBe("*.dev.magic.nycu.club");
		expect(() => normalize({ content: "192.0.2.1", name: "foo*", namespace, ttl: 1, type: "A" })).toThrow();
	});
});

describe("cache purge validation and authorization", () => {
	const config: AppConfig = {
		allowProxiedDeepSubdomains: false,
		appOrigin: "http://localhost:5173",
		bootstrapAdminGithubIds: new Set(),
		enablePurgeEverything: false,
		environment: "local",
		protectedHostnames: new Set(["api.nycu.club"]),
		protectedRecordIds: new Set(),
		sessionMaxAgeSeconds: 604_800,
		zoneId: "zone",
		zoneName: "nycu.club"
	};
	const member = sessionFor("member", { grants: [namespace] });

	it("normalizes and deduplicates authorized URLs", () => {
		const urls = normalizePurgeUrls({ urls: ["https://magic.nycu.club/a", "https://magic.nycu.club/a"] });
		expect(urls).toEqual(["https://magic.nycu.club/a"]);
		expect(assertHostnameAccess(member, new URL(urls[0] ?? "").hostname, config)).toBe(namespace);
	});

	it.each(["ftp://magic.nycu.club/file", "https://user:password@magic.nycu.club/private", "https://magic.nycu.club:99999/file", "not a url"])("rejects unsafe URL %s", url => {
		expect(() => normalizePurgeUrls({ urls: [url] })).toThrow(AppError);
	});

	it("rejects unauthorized, protected, and boundary-attack hostnames", () => {
		expect(() => assertHostnameAccess(member, "photo.nycu.club", config)).toThrow(/權限/u);
		expect(() => assertHostnameAccess(member, "evilmagic.nycu.club", config)).toThrow(/權限/u);
		expect(() => assertHostnameAccess(member, "api.nycu.club", config)).toThrow(/保護/u);
		expect(() => normalizePurgeHostnames({ hostnames: ["*.magic.nycu.club"] })).toThrow();
	});

	it.each(["magic.nycu.club/../admin", "magic.nycu.club/%2e%2e/admin", "magic.nycu.club/%252e%252e/admin", "magic.nycu.club/assets\\..\\admin"])("rejects prefix traversal %s", prefix => {
		expect(() => normalizePurgePrefixes({ prefixes: [prefix] })).toThrow(/traversal|encoding/u);
	});

	it("returns a normalized impact prefix", () => {
		expect(normalizePurgePrefixes({ prefixes: ["MAGIC.NYCU.CLUB/assets//images/"] })).toEqual([{ hostname: namespace, prefix: `${namespace}/assets/images` }]);
	});
});
