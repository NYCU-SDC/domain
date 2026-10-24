import { listNamespaceOptions, selectedNamespace } from "~/features/dashboard/server/namespaces.server";
import { requireDashboardPage } from "~/features/dashboard/server/page-auth.server";
import { listAuthorizedDnsRecords } from "~/features/dns/server/records.server";
import { getAppConfig } from "~/server/config.server";
import { PageHeader } from "~/shared/components/layout/PageHeader";
import { matchesNamespaceFilter } from "~/shared/lib/dns/hostname";
import { safeErrorDiagnostics, toAppError } from "~/shared/lib/errors";
import { createPrivateMeta } from "~/shared/lib/seo";
import { DnsManager } from "../components/DnsManager";
import type { Route } from "./+types/dashboard-dns";

export async function loader({ context, request }: Route.LoaderArgs) {
	const { csrfToken, runtime, session } = await requireDashboardPage(request, context);
	const config = getAppConfig(runtime.env);
	const namespaces = await listNamespaceOptions(session, runtime.env);
	const namespace = selectedNamespace(request, namespaces);
	const base = {
		allowProxiedDeepSubdomains: config.allowProxiedDeepSubdomains,
		csrfToken,
		grants: session.grants,
		isAdmin: session.user.isAdmin,
		knownSubdomains: namespaces.subdomains,
		requestId: runtime.requestId,
		selectedNamespace: namespace,
		zoneName: config.zoneName
	};
	try {
		const records = (await listAuthorizedDnsRecords(session, runtime.env, runtime.requestId)).filter(record => !namespace || matchesNamespaceFilter(record.name, namespace, config.zoneName));
		return { ...base, error: null, records };
	} catch (error) {
		const appError = toAppError(error);
		const diagnostics = safeErrorDiagnostics(error);
		console.error(
			JSON.stringify({
				code: appError.code,
				...diagnostics,
				message: "dns.list.failed",
				requestId: runtime.requestId,
				safeError: appError.message,
				userId: session.user.id
			})
		);
		return { ...base, error: appError.message, records: [] };
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
