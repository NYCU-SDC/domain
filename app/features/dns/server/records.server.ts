import type { AuthenticatedSession } from "~/features/auth/server/session.server";
import { canSeeRecord, isProtectedHostname, matchingNamespace } from "~/features/dns/server/authorization.server";
import { CloudflareClient, type CloudflareDnsRecord } from "~/server/cloudflare/client.server";
import { getAppConfig, requireSecret } from "~/server/config.server";

export interface DnsRecordView {
	readonly content: string | null;
	readonly createdOn: string | null;
	readonly data: Record<string, unknown> | null;
	readonly id: string;
	readonly modifiedOn: string | null;
	readonly name: string;
	readonly namespace: string | null;
	readonly priority: number | null;
	readonly protected: boolean;
	readonly proxiable: boolean;
	readonly proxied: boolean;
	readonly ttl: number;
	readonly type: string;
}

export function toDnsRecordView(record: CloudflareDnsRecord, session: AuthenticatedSession, env: Env): DnsRecordView {
	const config = getAppConfig(env);
	return {
		content: record.content ?? null,
		createdOn: record.created_on ?? null,
		data: record.data ?? null,
		id: record.id,
		modifiedOn: record.modified_on ?? null,
		name: record.name,
		namespace: session.user.isAdmin ? null : matchingNamespace(record.name, session.grants),
		priority: record.priority ?? null,
		protected: config.protectedRecordIds.has(record.id) || isProtectedHostname(record.name, config),
		proxiable: record.proxiable,
		proxied: record.proxied,
		ttl: record.ttl,
		type: record.type
	};
}

export async function listAuthorizedDnsRecords(session: AuthenticatedSession, env: Env, requestId: string): Promise<DnsRecordView[]> {
	const config = getAppConfig(env);
	const client = new CloudflareClient({
		apiToken: requireSecret(env, "CLOUDFLARE_API_TOKEN"),
		requestId,
		zoneId: config.zoneId
	});
	return (await client.listDnsRecords()).filter(record => canSeeRecord(session, record, config)).map(record => toDnsRecordView(record, session, env));
}
