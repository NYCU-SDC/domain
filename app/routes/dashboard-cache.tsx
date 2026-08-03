import { CacheManager } from "../components/CacheManager";
import { PageHeader } from "../components/PageHeader";
import { getAppConfig } from "../lib/server/config.server";
import { requireDashboardPage } from "../lib/server/pages/page-auth.server";
import type { Route } from "./+types/dashboard-cache";

export async function loader({ context, request }: Route.LoaderArgs) {
	const { csrfToken, runtime, session } = await requireDashboardPage(request, context);
	const config = getAppConfig(runtime.env);
	return {
		canPurgeEverything: session.user.isAdmin && config.enablePurgeEverything,
		csrfToken,
		grants: session.grants,
		isAdmin: session.user.isAdmin,
		zoneName: config.zoneName
	};
}

export const meta: Route.MetaFunction = () => [{ title: "快取管理｜nycu.club" }];

export default function DashboardCache({ loaderData }: Route.ComponentProps) {
	return (
		<div>
			<PageHeader title="快取管理" description="優先清除精確 URL；擴大到 hostname 或 prefix 前，請再次確認影響範圍。" />
			<CacheManager {...loaderData} />
		</div>
	);
}
