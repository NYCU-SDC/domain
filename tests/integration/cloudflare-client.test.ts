import { describe, expect, it, vi } from "vitest";

import { CloudflareClient } from "../../app/server/cloudflare/client.server";
import { AppError } from "../../app/shared/lib/errors";

const record = {
	content: "192.0.2.1",
	id: "0123456789abcdef0123456789abcdef",
	name: "magic.nycu.club",
	proxiable: true,
	proxied: false,
	ttl: 1,
	type: "A"
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
	return Response.json(body, init);
}

function client(fetcher: typeof fetch): CloudflareClient {
	return new CloudflareClient({
		apiToken: "cloudflare-test-token",
		fetcher,
		requestId: "request-test-1",
		zoneId: "zone-test-1"
	});
}

describe("explicit Cloudflare API client", () => {
	it("invokes fetch without binding it to the client instance", async () => {
		const fetcher: typeof fetch = function (this: unknown) {
			expect(this).toBeUndefined();
			return Promise.resolve(
				jsonResponse({
					errors: [],
					result: [record],
					result_info: { page: 1, total_pages: 1 },
					success: true
				})
			);
		};
		await expect(client(fetcher).listDnsRecords()).resolves.toHaveLength(1);
	});

	it("sets Bearer authorization and parses a successful record", async () => {
		const fetcher: typeof fetch = vi.fn(async (input, init) => {
			expect(String(input)).toContain("/zones/zone-test-1/dns_records/");
			const headers = new Headers(init?.headers);
			expect(headers.get("Authorization")).toBe("Bearer cloudflare-test-token");
			expect(headers.get("X-Request-ID")).toBe("request-test-1");
			return jsonResponse({ errors: [], result: record, success: true });
		});
		await expect(client(fetcher).getDnsRecord(record.id)).resolves.toMatchObject(record);
	});

	it("updates a record type atomically through the record PATCH endpoint", async () => {
		const fetcher: typeof fetch = vi.fn(async (input, init) => {
			expect(String(input)).toBe(`https://api.cloudflare.com/client/v4/zones/zone-test-1/dns_records/${record.id}`);
			expect(init?.method).toBe("PATCH");
			expect(JSON.parse(String(init?.body))).toEqual({
				content: "2001:db8::1",
				name: "magic.nycu.club",
				proxied: false,
				ttl: 1,
				type: "AAAA"
			});
			return jsonResponse({
				errors: [],
				result: { ...record, content: "2001:db8::1", type: "AAAA" },
				success: true
			});
		});
		await expect(
			client(fetcher).updateDnsRecord(record.id, {
				content: "2001:db8::1",
				name: "magic.nycu.club",
				proxied: false,
				ttl: 1,
				type: "AAAA"
			})
		).resolves.toMatchObject({ id: record.id, type: "AAAA" });
	});

	it("paginates list responses until total_pages without calling the real API", async () => {
		const fetcher: typeof fetch = vi.fn(async input => {
			const url = new URL(String(input));
			const page = Number(url.searchParams.get("page"));
			expect(url.searchParams.get("per_page")).toBe("5000");
			return jsonResponse({
				errors: [],
				result: [{ ...record, id: `${page}`.padStart(32, "0"), name: `${page}.magic.nycu.club` }],
				result_info: { page, total_pages: 2 },
				success: true
			});
		});
		const result = await client(fetcher).listDnsRecords();
		expect(result.map(item => item.name)).toEqual(["1.magic.nycu.club", "2.magic.nycu.club"]);
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it.each([
		[400, 1004, "bad content", "VALIDATION_ERROR"],
		[401, 9109, "unauthorized", "UPSTREAM_ERROR"],
		[404, 81044, "not found", "NOT_FOUND"],
		[409, 81058, "record already exists", "CONFLICT"],
		[422, 1004, "invalid", "VALIDATION_ERROR"],
		[429, 0, "rate limited", "RATE_LIMITED"]
	] as const)("maps upstream HTTP %s to %s", async (status, code, message, expectedCode) => {
		const fetcher: typeof fetch = async () =>
			jsonResponse(
				{
					errors: [{ code, message }],
					result: null,
					success: false
				},
				{ status }
			);
		const error = await client(fetcher)
			.getDnsRecord(record.id)
			.catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(AppError);
		expect((error as AppError).code).toBe(expectedCode);
		expect((error as AppError).message).not.toContain(JSON.stringify({ code, message }));
	});

	it("maps CNAME conflicts to a friendly message", async () => {
		const fetcher: typeof fetch = async () =>
			jsonResponse(
				{
					errors: [{ code: 81053, message: "CNAME conflicts with an existing A record" }],
					result: null,
					success: false
				},
				{ status: 400 }
			);
		await expect(
			client(fetcher).createDnsRecord({
				content: "target.example.com",
				name: "magic.nycu.club",
				proxied: false,
				ttl: 1,
				type: "CNAME"
			})
		).rejects.toThrow(/CNAME.*A、AAAA/u);
	});

	it("rejects malformed and non-JSON upstream responses", async () => {
		const malformed: typeof fetch = async () => jsonResponse({ result: record });
		await expect(client(malformed).getDnsRecord(record.id)).rejects.toThrow(/envelope/u);

		const nonJson: typeof fetch = async () =>
			new Response("gateway html", {
				headers: { "Content-Type": "text/html" },
				status: 502
			});
		await expect(client(nonJson).getDnsRecord(record.id)).rejects.toThrow(/非 JSON/u);
	});

	it("maps network failures and timeouts without leaking details", async () => {
		const fetcher: typeof fetch = async () => {
			throw new Error("socket secret detail");
		};
		const error = await client(fetcher)
			.getZone()
			.catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(AppError);
		expect((error as AppError).code).toBe("UPSTREAM_ERROR");
		expect((error as AppError).message).not.toContain("socket secret detail");
	});

	it("uses only explicit purge payloads", async () => {
		const bodies: unknown[] = [];
		const fetcher: typeof fetch = async (_input, init) => {
			bodies.push(JSON.parse(String(init?.body)) as unknown);
			return jsonResponse({ errors: [], result: { id: "zone-test-1" }, success: true });
		};
		const api = client(fetcher);
		await api.purgeUrls(["https://magic.nycu.club/a"]);
		await api.purgeHostnames(["magic.nycu.club"]);
		await api.purgePrefixes(["magic.nycu.club/assets"]);
		await api.purgeEverything();
		expect(bodies).toEqual([{ files: ["https://magic.nycu.club/a"] }, { hosts: ["magic.nycu.club"] }, { prefixes: ["magic.nycu.club/assets"] }, { purge_everything: true }]);
	});
});
