import { Link } from "react-router";

import { Breadcrumbs } from "~/shared/components/navigation/Breadcrumbs";
import { createPublicMeta } from "~/shared/lib/seo";
import type { Route } from "./+types/site-map";
import styles from "./public-info.module.css";

export const meta: Route.MetaFunction = () =>
	createPublicMeta({
		description: "nycu.club 網站導覽、公開頁面清單與鍵盤導覽方式說明。",
		path: "/sitemap",
		title: "網站導覽（SITE MAP）｜nycu.club"
	});

const siteLinks = [
	{ description: "了解免費社團子網域服務、可管理功能與常見問題。", label: "首頁", to: "/" },
	{ description: "填寫社團、申請人、聯絡方式與預計用途。", label: "申請子網域", to: "/apply" },
	{ description: "了解登入、DNS record、Cloudflare Proxy 與 cache 管理方式。", label: "使用說明", to: "/docs" },
	{ description: "了解資料最小化、憑證處理、權限邊界與安全事件回報方式。", label: "隱私與安全", to: "/security" },
	{ description: "使用 GitHub 登入已獲授權的 nycu.club 管理帳號。", label: "登入", to: "/login" }
] as const;

export default function SiteMapPage() {
	return (
		<main className={styles.main} id="main-content" tabIndex={-1}>
			<article className={styles.content}>
				<Breadcrumbs current="網站導覽" />
				<h1>網站導覽（SITE MAP）</h1>

				<section className={`card ${styles.instructions}`} aria-labelledby="keyboard-navigation-title">
					<h2 id="keyboard-navigation-title">鍵盤與網站導覽說明</h2>
					<p>本網站使用頁首、主要導覽、主要內容及頁尾等語意化區塊，螢幕報讀軟體可透過 landmark 快速移動至所需內容。</p>
					<ul className={styles.navigationList}>
						<li>使用鍵盤進入頁面時，可在第一個焦點按 Enter 啟用「跳到主要內容」，略過重複導覽。</li>
						<li>內頁提供麵包屑，說明目前頁面位置並可返回首頁。</li>
						<li>頁尾提供網站導覽連結；下方「公開頁面」也列出本站所有公開內容。</li>
					</ul>
				</section>

				<section className={styles.siteMapSection} aria-labelledby="pages-title">
					<h2 id="pages-title">公開頁面</h2>
					<ul className={styles.siteMapList}>
						{siteLinks.map(link => (
							<li className="card" key={link.to}>
								<Link to={link.to}>{link.label}</Link>
								<p>{link.description}</p>
							</li>
						))}
					</ul>
				</section>
			</article>
		</main>
	);
}
