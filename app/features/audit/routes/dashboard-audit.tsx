import { requireDashboardPage } from "~/features/dashboard/server/page-auth.server";
import { PageHeader } from "~/shared/components/layout/PageHeader";
import { createPrivateMeta } from "~/shared/lib/seo";
import { AuditTable } from "../components/AuditTable";
import type { Route } from "./+types/dashboard-audit";

function redactMemberSnapshot(value: string | null): string | null {
	if (!value) return null;
	try {
		const redact = (entry: unknown): unknown => {
			if (Array.isArray(entry)) return entry.map(redact);
			if (entry && typeof entry === "object") {
				return Object.fromEntries(
					Object.entries(entry)
						.filter(([key]) => key !== "note")
						.map(([key, child]) => [key, redact(child)])
				);
			}
			return entry;
		};
		return JSON.stringify(redact(JSON.parse(value) as unknown));
	} catch {
		return null;
	}
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const { runtime, session } = await requireDashboardPage(request, context);
	const namespaces = session.grants;
	const namespaceClause = namespaces.length ? `OR ((action LIKE 'dns.%' OR action LIKE 'cache.%') AND namespace IN (${namespaces.map(() => "?").join(",")}))` : "";
	const rows = await runtime.env.DB.prepare(
		`SELECT id, request_id AS requestId, action, target_type AS targetType,
        target_id AS targetId, namespace, hostname, status, before_json AS beforeJson,
        after_json AS afterJson, error_code AS errorCode, error_message AS errorMessage,
        created_at AS createdAt
       FROM audit_logs
       WHERE actor_user_id = ? ${namespaceClause}
       ORDER BY created_at DESC LIMIT 200`
	)
		.bind(session.user.id, ...namespaces)
		.all<{
			action: string;
			afterJson: string | null;
			beforeJson: string | null;
			createdAt: number;
			errorCode: string | null;
			errorMessage: string | null;
			hostname: string | null;
			id: string;
			namespace: string | null;
			requestId: string;
			status: string;
			targetId: string | null;
			targetType: string | null;
		}>();
	return {
		items: rows.results.map(row => ({
			...row,
			afterJson: redactMemberSnapshot(row.afterJson),
			beforeJson: redactMemberSnapshot(row.beforeJson)
		}))
	};
}

export const meta: Route.MetaFunction = () => createPrivateMeta("操作紀錄｜nycu.club");

export default function DashboardAudit({ loaderData }: Route.ComponentProps) {
	return (
		<div>
			<PageHeader title="操作紀錄" description="你只能查看自己的操作，以及目前有權限 namespace 的 DNS／cache 事件。IP、token 與 admin note 不會顯示。" />
			<AuditTable items={loaderData.items} />
		</div>
	);
}
