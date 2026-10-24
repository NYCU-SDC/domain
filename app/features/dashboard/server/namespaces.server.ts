import type { AuthenticatedSession } from "~/features/auth/server/session.server";
import { getAppConfig } from "~/server/config.server";
import { normalizeHostname } from "~/shared/lib/dns/hostname";

export interface NamespaceOptions {
	/** Zone apex; only admins manage records owned by the root. */
	readonly root: string | null;
	readonly subdomains: string[];
	readonly zoneName: string;
}

export async function listNamespaceOptions(session: AuthenticatedSession, env: Env): Promise<NamespaceOptions> {
	const { zoneName } = getAppConfig(env);
	if (!session.user.isAdmin) return { root: null, subdomains: [...session.grants].sort(), zoneName };
	const rows = await env.DB.prepare("SELECT DISTINCT namespace FROM namespace_grants ORDER BY namespace ASC").all<{ namespace: string }>();
	return { root: zoneName, subdomains: rows.results.map(row => row.namespace), zoneName };
}

/** Reads `?namespace=` and drops values outside the caller's options so the filter can never widen access. */
export function selectedNamespace(request: Request, options: NamespaceOptions): string | null {
	const raw = new URL(request.url).searchParams.get("namespace");
	if (!raw) return null;
	try {
		const namespace = normalizeHostname(raw);
		if (namespace === options.root || options.subdomains.includes(namespace)) return namespace;
		if (options.root && namespace.endsWith(`.${options.zoneName}`)) return namespace;
	} catch {
		return null;
	}
	return null;
}
