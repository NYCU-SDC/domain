import { DnsManager } from "../components/DnsManager";
import { PageHeader } from "../components/PageHeader";
import { getAppConfig } from "../lib/server/config.server";
import { listAuthorizedDnsRecords } from "../lib/server/dns/records.server";
import { requireDashboardPage } from "../lib/server/pages/page-auth.server";
import type { Route } from "./+types/dashboard-dns";

export async function loader({ context, request }: Route.LoaderArgs) {
	const { csrfToken, runtime, session } = await requireDashboardPage(request, context);
	const config = getAppConfig(runtime.env);
	try {
		const records = await listAuthorizedDnsRecords(session, runtime.env, runtime.requestId);
		return {
			allowProxiedDeepSubdomains: config.allowProxiedDeepSubdomains,
			csrfToken,
			error: null,
			grants: session.grants,
			isAdmin: session.user.isAdmin,
			records,
			requestId: runtime.requestId,
			zoneName: config.zoneName
		};
	} catch {
		return {
			allowProxiedDeepSubdomains: config.allowProxiedDeepSubdomains,
			csrfToken,
			error: "無法從 Cloudflare 讀取 DNS records。請稍後重試。",
			grants: session.grants,
			isAdmin: session.user.isAdmin,
			records: [],
			requestId: runtime.requestId,
			zoneName: config.zoneName
		};
	}
}

export const meta: Route.MetaFunction = () => [{ title: "DNS Records｜nycu.club" }];

export default function DashboardDns({ loaderData }: Route.ComponentProps) {
	return (
		<div>
			<PageHeader title="DNS Records" description="Cloudflare DNS 是唯一 source of truth；清單已在 Worker 依 namespace 過濾。" />
			<DnsManager {...loaderData} />
		</div>
	);
}
