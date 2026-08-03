import { requireDashboardPage } from "~/features/dashboard/server/page-auth.server";
import { listAuthorizedDnsRecords } from "~/features/dns/server/records.server";
import { getAppConfig } from "~/server/config.server";
import { PageHeader } from "~/shared/components/layout/PageHeader";
import { toAppError } from "~/shared/lib/errors";
import { createPrivateMeta } from "~/shared/lib/seo";
import { DnsManager } from "../components/DnsManager";
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
	} catch (error) {
		const appError = toAppError(error);
		console.error(
			JSON.stringify({
				code: appError.code,
				message: "dns.list.failed",
				requestId: runtime.requestId,
				safeError: appError.message,
				userId: session.user.id
			})
		);
		return {
			allowProxiedDeepSubdomains: config.allowProxiedDeepSubdomains,
			csrfToken,
			error: appError.message,
			grants: session.grants,
			isAdmin: session.user.isAdmin,
			records: [],
			requestId: runtime.requestId,
			zoneName: config.zoneName
		};
	}
}

export const meta: Route.MetaFunction = () => createPrivateMeta("DNS Records｜nycu.club");

export default function DashboardDns({ loaderData }: Route.ComponentProps) {
	return (
		<div>
			<PageHeader title="DNS Records" description="Cloudflare DNS 是唯一 source of truth；清單已在 Worker 依 namespace 過濾。" />
			<DnsManager {...loaderData} />
		</div>
	);
}
