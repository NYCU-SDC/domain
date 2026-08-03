import { index, layout, route, type RouteConfig } from "@react-router/dev/routes";

export default [
	layout("shared/components/layout/PublicLayout.tsx", [
		index("features/public/routes/landing.tsx"),
		route("apply", "features/applications/routes/apply.tsx"),
		route("login", "features/auth/routes/login.tsx"),
		route("security", "features/public/routes/security.tsx"),
		route("status", "features/public/routes/status.tsx"),
		route("docs", "features/public/routes/docs.tsx")
	]),
	route("auth/github", "features/auth/routes/auth-github.ts"),
	route("auth/github/callback", "features/auth/routes/auth-callback.ts"),
	route("logout", "features/auth/routes/logout.ts"),
	route("access-pending", "features/auth/routes/access-pending.tsx"),
	route("api/v1/*", "features/api/routes/api.ts"),
	route("sitemap.xml", "features/seo/routes/sitemap.ts"),
	layout("features/dashboard/routes/dashboard-layout.tsx", [
		route("dashboard", "features/dashboard/routes/dashboard-overview.tsx"),
		route("dashboard/dns", "features/dns/routes/dashboard-dns.tsx"),
		route("dashboard/cache", "features/cache/routes/dashboard-cache.tsx"),
		route("dashboard/audit", "features/audit/routes/dashboard-audit.tsx"),
		route("dashboard/account", "features/account/routes/dashboard-account.tsx"),
		route("admin", "features/admin/routes/admin-overview.tsx"),
		route("admin/applications", "features/admin/routes/admin-applications.tsx"),
		route("admin/users", "features/admin/routes/admin-users.tsx")
	])
] satisfies RouteConfig;
