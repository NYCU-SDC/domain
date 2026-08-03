import { z } from "zod";

import { AppError, validationErrorFromZod } from "../errors";
import { isDeepSubdomain, normalizeHostname, resolveRelativeOwner } from "./hostname";

export const allowedDnsTypes = ["A", "AAAA", "CNAME", "TXT", "MX", "SRV", "CAA"] as const;
export type AllowedDnsType = (typeof allowedDnsTypes)[number];

const ttlSchema = z
	.number()
	.int()
	.refine(ttl => ttl === 1 || (ttl >= 60 && ttl <= 86_400), {
		message: "TTL 必須為 Auto (1) 或 60 到 86400 秒"
	});
const relativeNameSchema = z.string().min(1).max(253);
const namespaceSchema = z.string().min(1).max(253);
const proxyBase = {
	name: relativeNameSchema,
	namespace: namespaceSchema,
	proxied: z.boolean().default(false),
	ttl: ttlSchema.default(1)
} as const;
const dnsOnlyBase = {
	name: relativeNameSchema,
	namespace: namespaceSchema,
	proxied: z.literal(false).optional().default(false),
	ttl: ttlSchema.default(1)
} as const;

export const dnsRecordInputSchema = z.discriminatedUnion("type", [
	z.strictObject({
		...proxyBase,
		content: z.ipv4({ message: "請輸入合法的 IPv4 address" }),
		type: z.literal("A")
	}),
	z.strictObject({
		...proxyBase,
		content: z.ipv6({ message: "請輸入合法的 IPv6 address" }),
		type: z.literal("AAAA")
	}),
	z.strictObject({
		...proxyBase,
		target: z.string().min(1).max(253),
		type: z.literal("CNAME")
	}),
	z.strictObject({
		...dnsOnlyBase,
		content: z.string().min(1, "TXT 內容不可為空").max(4096),
		type: z.literal("TXT")
	}),
	z.strictObject({
		...dnsOnlyBase,
		priority: z.number().int().min(0).max(65_535),
		target: z.string().min(1).max(253),
		type: z.literal("MX")
	}),
	z.strictObject({
		...dnsOnlyBase,
		name: relativeNameSchema,
		port: z.number().int().min(0).max(65_535),
		priority: z.number().int().min(0).max(65_535),
		protocol: z.string().regex(/^_?(?:tcp|udp|tls)$/iu, "Protocol 必須是 tcp、udp 或 tls"),
		service: z.string().regex(/^_?[a-z][a-z0-9-]{0,61}[a-z0-9]?$/iu, "Service 格式不正確"),
		target: z.string().min(1).max(253),
		type: z.literal("SRV"),
		weight: z.number().int().min(0).max(65_535)
	}),
	z.strictObject({
		...dnsOnlyBase,
		flags: z.number().int().min(0).max(255),
		tag: z.enum(["issue", "issuewild", "iodef"]),
		type: z.literal("CAA"),
		value: z.string().min(1).max(1024)
	})
]);

export type DnsRecordInput = z.infer<typeof dnsRecordInputSchema>;

export type CloudflareDnsMutation =
	| {
			content: string;
			name: string;
			proxied: boolean;
			ttl: number;
			type: "A" | "AAAA" | "CNAME" | "TXT";
	  }
	| {
			content: string;
			name: string;
			priority: number;
			proxied: false;
			ttl: number;
			type: "MX";
	  }
	| {
			data: {
				name: string;
				port: number;
				priority: number;
				proto: string;
				service: string;
				target: string;
				weight: number;
			};
			name: string;
			proxied: false;
			ttl: number;
			type: "SRV";
	  }
	| {
			data: { flags: number; tag: "issue" | "issuewild" | "iodef"; value: string };
			name: string;
			proxied: false;
			ttl: number;
			type: "CAA";
	  };

export interface NormalizedDnsMutation {
	readonly hostname: string;
	readonly namespace: string;
	readonly payload: CloudflareDnsMutation;
}

function ensureProxyTtl(proxied: boolean, ttl: number): void {
	if (proxied && ttl !== 1) {
		throw new AppError("VALIDATION_ERROR", "開啟 Cloudflare Proxy 時 TTL 必須設為 Auto");
	}
}

export function parseDnsRecordInput(input: unknown): DnsRecordInput {
	const result = dnsRecordInputSchema.safeParse(input);
	if (!result.success) throw validationErrorFromZod(result.error);
	return result.data;
}

export function normalizeDnsMutation(input: DnsRecordInput, zoneName: string, allowProxiedDeepSubdomains: boolean): NormalizedDnsMutation {
	const namespace = normalizeHostname(input.namespace, {
		allowUnderscore: false,
		allowWildcard: false
	});
	const baseHostname = resolveRelativeOwner(input.name, namespace);

	if (input.type === "SRV") {
		const service = `_${input.service.replace(/^_/u, "").toLowerCase()}`;
		const proto = `_${input.protocol.replace(/^_/u, "").toLowerCase()}`;
		const hostname = normalizeHostname(`${service}.${proto}.${baseHostname}`, {
			allowUnderscore: true,
			allowWildcard: false
		});
		const target = normalizeHostname(input.target, {
			allowUnderscore: false,
			allowWildcard: false
		});
		return {
			hostname,
			namespace,
			payload: {
				data: {
					name: baseHostname,
					port: input.port,
					priority: input.priority,
					proto,
					service,
					target,
					weight: input.weight
				},
				name: hostname,
				proxied: false,
				ttl: input.ttl,
				type: "SRV"
			}
		};
	}

	const proxied = input.type === "A" || input.type === "AAAA" || input.type === "CNAME" ? input.proxied : false;
	ensureProxyTtl(proxied, input.ttl);
	if (proxied && isDeepSubdomain(baseHostname, zoneName) && !allowProxiedDeepSubdomains) {
		throw new AppError("VALIDATION_ERROR", "此 hostname 是多層子網域，系統目前禁止開啟 Proxy；請改用 DNS only 或聯絡管理員確認憑證設定");
	}

	switch (input.type) {
		case "A":
		case "AAAA":
			return {
				hostname: baseHostname,
				namespace,
				payload: {
					content: input.content,
					name: baseHostname,
					proxied,
					ttl: input.ttl,
					type: input.type
				}
			};
		case "CNAME":
			return {
				hostname: baseHostname,
				namespace,
				payload: {
					content: normalizeHostname(input.target, {
						allowUnderscore: false,
						allowWildcard: false
					}),
					name: baseHostname,
					proxied,
					ttl: input.ttl,
					type: "CNAME"
				}
			};
		case "TXT":
			return {
				hostname: baseHostname,
				namespace,
				payload: {
					content: input.content,
					name: baseHostname,
					proxied: false,
					ttl: input.ttl,
					type: "TXT"
				}
			};
		case "MX":
			return {
				hostname: baseHostname,
				namespace,
				payload: {
					content: normalizeHostname(input.target, {
						allowUnderscore: false,
						allowWildcard: false
					}),
					name: baseHostname,
					priority: input.priority,
					proxied: false,
					ttl: input.ttl,
					type: "MX"
				}
			};
		case "CAA":
			return {
				hostname: baseHostname,
				namespace,
				payload: {
					data: { flags: input.flags, tag: input.tag, value: input.value },
					name: baseHostname,
					proxied: false,
					ttl: input.ttl,
					type: "CAA"
				}
			};
	}
}

export const unsupportedDnsTypeReasons = {
	DNSKEY: "DNSKEY 與 DNSSEC 簽章機制相關，由 authoritative DNS provider 管理，不開放透過本平台修改。",
	DS: "DS 是 DNSSEC delegation chain 的一部分，錯誤設定可能造成整個子網域無法解析，因此只由系統管理員透過 Cloudflare 管理。",
	NS: "NS 可以把整個子網域的 DNS 管理權委派到其他 nameserver，可能繞過本平台的權限與 audit 控制，因此不開放自行設定。如需完整 DNS delegation，請聯絡系統管理員。",
	PTR: "PTR 通常屬於 reverse DNS zone，並不是由 nycu.club 的一般 forward DNS zone 管理。",
	SOA: "SOA 是 DNS zone 的權威中繼資料，由 Cloudflare 自動管理。",
	其他類型: "HTTPS、SVCB、NAPTR、TLSA、SSHFP、LOC 等類型目前尚未開放，因為需要額外的欄位驗證與權限規則。如有實際需求，請向系統管理員申請。"
} as const;
