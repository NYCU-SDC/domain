import type { Route } from "./+types/dashboard-account";
import { AccountSessions } from "../components/AccountSessions";
import { PageHeader } from "../components/PageHeader";
import { requireDashboardPage } from "../lib/server/pages/page-auth.server";

export async function loader({ context, request }: Route.LoaderArgs) {
  const { csrfToken, runtime, session } = await requireDashboardPage(request, context);
  const rows = await runtime.env.DB
    .prepare(
      `SELECT id, created_at AS createdAt, expires_at AS expiresAt,
       last_seen_at AS lastSeenAt, revoked_at AS revokedAt
       FROM sessions WHERE user_id = ? ORDER BY created_at DESC`,
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
    sessions: rows.results.map((item) => ({ ...item, current: item.id === session.id })),
    user: session.user,
  };
}

export const meta: Route.MetaFunction = () => [{ title: "帳號與 Sessions｜nycu.club" }];

export default function DashboardAccount({ loaderData }: Route.ComponentProps) {
  return (
    <div>
      <PageHeader eyebrow="ACCOUNT" title="帳號與 Sessions" description="身分綁定 GitHub numeric ID；username 改名不會改變既有權限。" />
      <AccountSessions {...loaderData} />
    </div>
  );
}
