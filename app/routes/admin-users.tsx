import type { Route } from "./+types/admin-users";
import { AdminUsersManager } from "../components/AdminUsersManager";
import { PageHeader } from "../components/PageHeader";
import { listAdminUsers } from "../lib/server/admin/users.server";
import { requireDashboardPage } from "../lib/server/pages/page-auth.server";

export async function loader({ context, request }: Route.LoaderArgs) {
  const { csrfToken, runtime } = await requireDashboardPage(request, context, true);
  const users = await listAdminUsers(runtime.env.DB, runtime.env, {
    admin: "all",
    page: 1,
    perPage: 100,
    search: "",
    status: "all",
  });
  return { csrfToken, users: users.items };
}

export const meta: Route.MetaFunction = () => [{ title: "使用者管理｜nycu.club" }];

export default function AdminUsers({ loaderData }: Route.ComponentProps) {
  return (
    <div>
      <PageHeader eyebrow="ADMIN / USERS" title="使用者與權限" description="管理 status、admin、internal note 與 namespace grants。權限變更後，該使用者必須重新登入。" />
      <AdminUsersManager {...loaderData} />
    </div>
  );
}
