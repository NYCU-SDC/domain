import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteLoaderData } from "react-router";

import type { Route } from "./+types/root";
import { getWorkerRuntime } from "./server/runtime.server";
import "./styles/global.css";

export function loader({ context }: Route.LoaderArgs) {
	return { cspNonce: getWorkerRuntime(context).cspNonce };
}

export const links: Route.LinksFunction = () => [
	{ href: "/favicon.svg", rel: "icon", type: "image/svg+xml" },
	{ href: "/apple-touch-icon.png", rel: "apple-touch-icon", sizes: "180x180", type: "image/png" },
	{ href: "/apple-touch-icon-precomposed.png", rel: "apple-touch-icon-precomposed", sizes: "180x180", type: "image/png" },
	{ href: "https://nycu.club", rel: "canonical" },
	{ href: "https://avatars.githubusercontent.com", rel: "preconnect" }
];

export const meta: Route.MetaFunction = () => [
	{ title: "nycu.club｜社團子網域管理平台" },
	{
		content: "由軟體開發社維護，提供陽明交大社團自助式 DNS 與 Cloudflare cache 管理。",
		name: "description"
	},
	{ content: "website", property: "og:type" },
	{ content: "nycu.club 社團子網域管理平台", property: "og:title" },
	{ content: "zh_TW", property: "og:locale" }
];

export function Layout({ children }: { children: React.ReactNode }) {
	const data = useRouteLoaderData<typeof loader>("root");
	const nonce = data?.cspNonce;
	return (
		<html lang="zh-Hant">
			<head>
				<meta charSet="utf-8" />
				<meta content="width=device-width, initial-scale=1" name="viewport" />
				<meta content="#F4E9E1" name="theme-color" />
				<Meta />
				<Links nonce="" />
			</head>
			<body>
				<a className="skipLink" href="#main-content">
					跳到主要內容
				</a>
				{children}
				<ScrollRestoration nonce={nonce} />
				<Scripts nonce={nonce} />
			</body>
		</html>
	);
}

export default function App() {
	return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	let title = "系統發生錯誤";
	let detail = "請稍後再試；若問題持續發生，請提供頁面上的 request ID 給系統管理員。";
	let status = 500;
	if (isRouteErrorResponse(error)) {
		status = error.status;
		title = error.status === 404 ? "找不到這個頁面" : "無法完成請求";
		detail = error.status === 404 ? "這個網址不存在，或資源已被移除。" : error.statusText || detail;
	} else if (import.meta.env.DEV && error instanceof Error) {
		detail = error.message;
	}
	return (
		<main className="errorPage" id="main-content">
			<a className="brand" href="/" aria-label="回到 nycu.club 首頁">
				nycu.club
			</a>
			<p>錯誤代碼 {status}</p>
			<h1>{title}</h1>
			<p>{detail}</p>
			<a className="button buttonPrimary" href="/">
				回到首頁
			</a>
		</main>
	);
}
