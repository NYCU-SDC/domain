import { index, layout, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/landing.tsx"),
  route("login", "routes/login.tsx"),
  route("security", "routes/security.tsx"),
  route("status", "routes/status.tsx"),
  route("docs", "routes/docs.tsx"),
  route("auth/github", "routes/auth-github.ts"),
  route("auth/github/callback", "routes/auth-callback.ts"),
  route("logout", "routes/logout.ts"),
  route("access-pending", "routes/access-pending.tsx"),
  route("api/v1/*", "routes/api.ts"),
  layout("routes/dashboard-layout.tsx", [
    route("dashboard", "routes/dashboard-overview.tsx"),
    route("dashboard/dns", "routes/dashboard-dns.tsx"),
    route("dashboard/cache", "routes/dashboard-cache.tsx"),
    route("dashboard/audit", "routes/dashboard-audit.tsx"),
    route("dashboard/account", "routes/dashboard-account.tsx"),
    route("admin", "routes/admin-overview.tsx"),
    route("admin/users", "routes/admin-users.tsx"),
  ]),
] satisfies RouteConfig;
