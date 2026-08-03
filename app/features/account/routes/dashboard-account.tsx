import { requireDashboardPage } from "~/features/dashboard/server/page-auth.server";
import { PageHeader } from "~/shared/components/layout/PageHeader";
import { createPrivateMeta } from "~/shared/lib/seo";
import { AccountSessions } from "../components/AccountSessions";
import type { Route } from "./+types/dashboard-account";

export async function loader({ context, request }: Route.LoaderArgs) {
	const { csrfToken, runtime, session } = await requireDashboardPage(request, context);
	const rows = await runtime.env.DB.prepare(
		`SELECT id, created_at AS createdAt, expires_at AS expiresAt,
       last_seen_at AS lastSeenAt, revoked_at AS revokedAt
       FROM sessions WHERE user_id = ? ORDER BY created_at DESC`
	)
		.bind(session.user.id)
		.all<{
			createdAt: number;
			expiresAt: number;
			id: string;
			lastSeenAt: number;
			revokedAt: number | null;
		}>();
	return {
		csrfToken,
		grants: session.grants,
		sessions: rows.results.map(item => ({ ...item, current: item.id === session.id })),
		user: session.user
	};
}

export const meta: Route.MetaFunction = () => createPrivateMeta("帳號與 Sessions｜nycu.club");

export default function DashboardAccount({ loaderData }: Route.ComponentProps) {
	return (
		<div>
			<PageHeader title="帳號與 Sessions" description="身分綁定 GitHub numeric ID；username 改名不會改變既有權限。" />
			<AccountSessions {...loaderData} />
		</div>
	);
}
