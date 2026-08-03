import { z } from "zod";

import type { CloudflareDnsMutation } from "../../shared/dns/records";
import { AppError } from "../../shared/errors";

const API_BASE_URL = "https://api.cloudflare.com/client/v4";
const RESPONSE_LIMIT_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

const cloudflareErrorSchema = z.object({
	code: z.union([z.number(), z.string()]),
	message: z.string()
});

const recordDataSchema = z.record(z.string(), z.unknown());
const dnsRecordSchema = z.looseObject({
	content: z.string().optional(),
	created_on: z.string().optional(),
	data: recordDataSchema.optional(),
	id: z.string().min(1).max(64),
	modified_on: z.string().optional(),
	name: z.string().min(1).max(255),
	priority: z.number().int().optional(),
	proxiable: z.boolean().optional().default(false),
	proxied: z.boolean().optional().default(false),
	ttl: z.number().int(),
	type: z.string().min(1).max(16)
});

const zoneSchema = z.looseObject({
	id: z.string().min(1),
	name: z.string().min(1),
	status: z.string().min(1)
});

const purgeResultSchema = z.looseObject({ id: z.string().optional() });

export type CloudflareDnsRecord = z.infer<typeof dnsRecordSchema>;
export type CloudflareZone = z.infer<typeof zoneSchema>;

const listEnvelopeSchema = z.object({
	errors: z.array(cloudflareErrorSchema).optional().default([]),
	result: z.array(dnsRecordSchema),
	result_info: z
		.object({
			page: z.number().int().optional(),
			total_pages: z.number().int().optional()
		})
		.optional(),
	success: z.boolean()
});

interface CloudflareClientOptions {
	readonly apiToken: string;
	readonly fetcher?: typeof fetch;
	readonly requestId: string;
	readonly zoneId: string;
}

async function readBoundedJson(response: Response): Promise<unknown> {
	if (!response.body) return null;
	const declaredLength = Number(response.headers.get("Content-Length") ?? 0);
	if (declaredLength > RESPONSE_LIMIT_BYTES) {
		throw new AppError("UPSTREAM_ERROR", "Cloudflare API response 超過安全大小限制");
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > RESPONSE_LIMIT_BYTES) {
			await reader.cancel();
			throw new AppError("UPSTREAM_ERROR", "Cloudflare API response 超過安全大小限制");
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
	} catch (error) {
		throw new AppError("UPSTREAM_ERROR", "Cloudflare API 回傳了非 JSON response", {
			cause: error
		});
	}
}

function mapCloudflareError(status: number, errors: ReadonlyArray<z.infer<typeof cloudflareErrorSchema>>): AppError {
	const safeError = errors[0];
	const safeCode = safeError ? String(safeError.code).slice(0, 32) : undefined;
	const upstreamMessage = safeError?.message.toLowerCase() ?? "";
	if (status === 429) {
		return new AppError("RATE_LIMITED", "Cloudflare API rate limit 已達上限，請稍後再試");
	}
	if (status === 401 || status === 403) {
		return new AppError("UPSTREAM_ERROR", "Cloudflare API Token 權限不足或已失效");
	}
	if (status === 404) return new AppError("NOT_FOUND", "指定的 DNS record 不存在");
	if (status === 409 || upstreamMessage.includes("already exists") || upstreamMessage.includes("cname")) {
		const message = upstreamMessage.includes("cname") ? "CNAME 無法與同名的 A、AAAA 或其他 CNAME record 並存" : "相同的 DNS record 已存在，或與現有設定衝突";
		return new AppError("CONFLICT", message);
	}
	if (status === 400 || status === 422) {
		return new AppError("VALIDATION_ERROR", safeCode ? `Cloudflare 拒絕了 DNS 資料（code ${safeCode}）` : "Cloudflare 拒絕了 DNS 資料");
	}
	return new AppError("UPSTREAM_ERROR", safeCode ? `Cloudflare API 暫時無法完成操作（code ${safeCode}）` : "Cloudflare API 暫時無法完成操作");
}

export class CloudflareClient {
	readonly #apiToken: string;
	readonly #fetcher: typeof fetch;
	readonly #requestId: string;
	readonly #zoneId: string;

	constructor(options: CloudflareClientOptions) {
		this.#apiToken = options.apiToken;
		this.#fetcher = options.fetcher ?? fetch;
		this.#requestId = options.requestId;
		this.#zoneId = options.zoneId;
	}

	async #request(path: string, init: RequestInit = {}): Promise<unknown> {
		let response: Response;
		try {
			const headers = new Headers(init.headers);
			headers.set("Accept", "application/json");
			headers.set("Authorization", `Bearer ${this.#apiToken}`);
			headers.set("Content-Type", "application/json");
			headers.set("X-Request-ID", this.#requestId);
			response = await this.#fetcher(`${API_BASE_URL}${path}`, {
				...init,
				headers,
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
			});
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError("UPSTREAM_ERROR", "Cloudflare API request timeout 或網路錯誤", {
				cause: error
			});
		}
		const json = await readBoundedJson(response);
		const envelope = z
			.object({
				errors: z.array(cloudflareErrorSchema).optional().default([]),
				result: z.unknown().optional(),
				success: z.boolean()
			})
			.safeParse(json);
		if (!envelope.success) {
			throw new AppError("UPSTREAM_ERROR", "Cloudflare API response envelope 格式不正確");
		}
		if (!response.ok || !envelope.data.success) {
			throw mapCloudflareError(response.status, envelope.data.errors);
		}
		return envelope.data.result;
	}

	async getZone(): Promise<CloudflareZone> {
		const result = zoneSchema.safeParse(await this.#request(`/zones/${this.#zoneId}`));
		if (!result.success) throw new AppError("UPSTREAM_ERROR", "Cloudflare zone 格式不完整");
		return result.data;
	}

	async listDnsRecords(): Promise<CloudflareDnsRecord[]> {
		const records: CloudflareDnsRecord[] = [];
		let page = 1;
		while (true) {
			const response = await this.#fetcher(`${API_BASE_URL}/zones/${this.#zoneId}/dns_records?page=${page}&per_page=5000&order=name&direction=asc`, {
				headers: {
					Accept: "application/json",
					Authorization: `Bearer ${this.#apiToken}`,
					"X-Request-ID": this.#requestId
				},
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
			}).catch((error: unknown) => {
				throw new AppError("UPSTREAM_ERROR", "Cloudflare DNS list timeout 或網路錯誤", {
					cause: error
				});
			});
			const json = await readBoundedJson(response);
			const parsed = listEnvelopeSchema.safeParse(json);
			if (!parsed.success) {
				throw new AppError("UPSTREAM_ERROR", "Cloudflare DNS list response 格式不正確");
			}
			if (!response.ok || !parsed.data.success) {
				throw mapCloudflareError(response.status, parsed.data.errors);
			}
			records.push(...parsed.data.result);
			const totalPages = parsed.data.result_info?.total_pages ?? page;
			if (page >= totalPages) break;
			page += 1;
		}
		return records;
	}

	async getDnsRecord(recordId: string): Promise<CloudflareDnsRecord> {
		const result = dnsRecordSchema.safeParse(await this.#request(`/zones/${this.#zoneId}/dns_records/${recordId}`));
		if (!result.success) throw new AppError("UPSTREAM_ERROR", "Cloudflare DNS record 格式不完整");
		return result.data;
	}

	async createDnsRecord(payload: CloudflareDnsMutation): Promise<CloudflareDnsRecord> {
		const result = dnsRecordSchema.safeParse(
			await this.#request(`/zones/${this.#zoneId}/dns_records`, {
				body: JSON.stringify(payload),
				method: "POST"
			})
		);
		if (!result.success) throw new AppError("UPSTREAM_ERROR", "Cloudflare create response 格式不完整");
		return result.data;
	}

	async updateDnsRecord(recordId: string, payload: CloudflareDnsMutation): Promise<CloudflareDnsRecord> {
		const result = dnsRecordSchema.safeParse(
			await this.#request(`/zones/${this.#zoneId}/dns_records/${recordId}`, {
				body: JSON.stringify(payload),
				method: "PATCH"
			})
		);
		if (!result.success) throw new AppError("UPSTREAM_ERROR", "Cloudflare update response 格式不完整");
		return result.data;
	}

	async deleteDnsRecord(recordId: string): Promise<{ id: string }> {
		const result = z.object({ id: z.string() }).safeParse(
			await this.#request(`/zones/${this.#zoneId}/dns_records/${recordId}`, {
				method: "DELETE"
			})
		);
		if (!result.success) throw new AppError("UPSTREAM_ERROR", "Cloudflare delete response 格式不完整");
		return result.data;
	}

	async #purge(body: object): Promise<{ id?: string }> {
		const result = purgeResultSchema.safeParse(
			await this.#request(`/zones/${this.#zoneId}/purge_cache`, {
				body: JSON.stringify(body),
				method: "POST"
			})
		);
		if (!result.success) throw new AppError("UPSTREAM_ERROR", "Cloudflare purge response 格式不完整");
		return result.data;
	}

	purgeUrls(urls: readonly string[]): Promise<{ id?: string }> {
		return this.#purge({ files: urls });
	}

	purgeHostnames(hostnames: readonly string[]): Promise<{ id?: string }> {
		return this.#purge({ hosts: hostnames });
	}

	purgePrefixes(prefixes: readonly string[]): Promise<{ id?: string }> {
		return this.#purge({ prefixes });
	}

	purgeEverything(): Promise<{ id?: string }> {
		return this.#purge({ purge_everything: true });
	}
}
