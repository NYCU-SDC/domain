import { ChevronDown, ClipboardList, Database, Gauge, History, LayoutDashboard, LogOut, Menu, ShieldCheck, UserRound, Users, X } from "lucide-react";
import { useState } from "react";
import { Form, NavLink, Outlet } from "react-router";

import { ThemeToggle } from "../components/ThemeToggle";
import { ToastProvider } from "../components/ToastProvider";
import { requireDashboardPage } from "../lib/server/pages/page-auth.server";
import type { Route } from "./+types/dashboard-layout";
import styles from "./dashboard.module.css";

export async function loader({ context, request }: Route.LoaderArgs) {
	const { csrfToken, session } = await requireDashboardPage(request, context);
	return { csrfToken, grants: session.grants, user: session.user };
}

const navigation = [
	{ icon: LayoutDashboard, label: "總覽", to: "/dashboard" },
	{ icon: Database, label: "DNS Records", to: "/dashboard/dns" },
	{ icon: Gauge, label: "快取管理", to: "/dashboard/cache" },
	{ icon: History, label: "操作紀錄", to: "/dashboard/audit" },
	{ icon: UserRound, label: "帳號", to: "/dashboard/account" }
] as const;

export default function DashboardLayout({ loaderData }: Route.ComponentProps) {
	const [menuOpen, setMenuOpen] = useState(false);
	return (
		<ToastProvider>
			<div className={styles.shell}>
				<aside className={styles.sidebar} data-open={menuOpen}>
					<div className={styles.sidebarTop}>
						<NavLink className="brand" to="/dashboard" translate="no">
							nycu.club
						</NavLink>
						<button className={styles.closeMenu} onClick={() => setMenuOpen(false)} type="button" aria-label="關閉選單">
							<X />
						</button>
					</div>
					<nav className={styles.sideNav} aria-label="Dashboard 導覽">
						<p>管理工具</p>
						{navigation.map(({ icon: Icon, label, to }) => (
							<NavLink key={to} to={to} end={to === "/dashboard"} onClick={() => setMenuOpen(false)} className={({ isActive }) => (isActive ? styles.active : undefined)}>
								<Icon aria-hidden="true" /> {label}
							</NavLink>
						))}
						{loaderData.user.isAdmin ? (
							<>
								<p>系統管理</p>
								<NavLink to="/admin" end className={({ isActive }) => (isActive ? styles.active : undefined)}>
									<ShieldCheck />
									管理後台
								</NavLink>
								<NavLink to="/admin/applications" className={({ isActive }) => (isActive ? styles.active : undefined)}>
									<ClipboardList />
									子網域申請
								</NavLink>
								<NavLink to="/admin/users" className={({ isActive }) => (isActive ? styles.active : undefined)}>
									<Users />
									使用者
								</NavLink>
							</>
						) : null}
					</nav>
				</aside>
				{menuOpen ? <button className={styles.backdrop} onClick={() => setMenuOpen(false)} aria-label="關閉選單" type="button" /> : null}
				<div className={styles.workspace}>
					<header className={styles.topbar}>
						<button className={styles.menuButton} onClick={() => setMenuOpen(true)} type="button" aria-label="開啟選單">
							<Menu />
						</button>
						<label className={styles.namespaceSelect}>
							<span>Namespace</span>
							<select
								defaultValue="all"
								aria-label="選擇 namespace"
								name="namespace"
								onChange={event => {
									const url = new URL(window.location.href);
									if (event.target.value === "all") url.searchParams.delete("namespace");
									else url.searchParams.set("namespace", event.target.value);
									window.location.assign(url.toString());
								}}
							>
								<option value="all">全部可管理範圍</option>
								{loaderData.grants.map(grant => (
									<option key={grant} value={grant}>
										{grant}
									</option>
								))}
							</select>
							<ChevronDown aria-hidden="true" />
						</label>
						<div className={styles.headerActions}>
							<ThemeToggle />
							<div className={styles.profile}>
								<img src={loaderData.user.githubAvatarUrl} width="34" height="34" alt="" />
								<span>
									<b>@{loaderData.user.githubLogin}</b>
									<small>{loaderData.user.isAdmin ? "Administrator" : "Member"}</small>
								</span>
							</div>
							<Form action="/logout" method="post">
								<input type="hidden" name="csrfToken" value={loaderData.csrfToken} />
								<button className="button buttonGhost buttonSmall" aria-label="登出" title="登出" type="submit">
									<LogOut size={18} />
								</button>
							</Form>
						</div>
					</header>
					<main className={styles.content} id="main-content">
						<Outlet />
					</main>
				</div>
			</div>
		</ToastProvider>
	);
}

export function HydrateFallback() {
	return (
		<div className={styles.loadingShell}>
			<div className="skeleton" />
			<div className="skeleton" />
			<div className="skeleton" />
		</div>
	);
}
