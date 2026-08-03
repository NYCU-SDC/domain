import { ArrowRight, Check, ChevronDown, Cloud, Database, ExternalLink, GitFork, ListPlus, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import type { Route } from "./+types/landing";
import styles from "./landing.module.css";

export const meta: Route.MetaFunction = () => [
	{ title: "nycu.club｜免費陽明交大社團子網域" },
	{
		name: "description",
		content: "由交大軟體開發社維護，讓校內社團自行管理 nycu.club DNS、Cloudflare Proxy 與快取。"
	}
];

const faq = [
	["誰可以使用？", "陽明交大社團或校內單位的網站維護者都可以提出申請。審核通過後，管理權會綁定 GitHub numeric ID。"],
	["如何取得子網域權限？", "先填寫申請表單，說明社團、用途與想使用的 namespace。軟體開發社審核後，會請維護者用 GitHub 登入。"],
	["magic.nycu.club 的權限包含更深層子網域嗎？", "包含。你可以管理 magic.nycu.club、www.magic.nycu.club 與 api.dev.magic.nycu.club，但不能管理 evilmagic.nycu.club 或其他社團的範圍。"],
	["可以新增哪些 DNS 類型？", "目前開放 A、AAAA、CNAME、TXT、MX、SRV 與 CAA。NS、DS、DNSKEY、SOA、PTR 與其他尚未有完整欄位驗證的類型不開放自行設定。"],
	["為什麼不能新增 NS？", "NS 可以把整個子網域委派到其他 nameserver，可能繞過平台的權限控制。如需完整 DNS delegation，請聯絡系統管理員。"],
	["什麼是 Cloudflare Proxy？", "Proxy 讓 HTTP 流量經過 Cloudflare，使用 CDN、安全與 TLS 功能；DNS only 則只提供 DNS 解析。A、AAAA 與 CNAME 才能切換 Proxy。"],
	["為什麼某些深層子網域不能開啟 Proxy？", "一般 Universal SSL 通常只涵蓋根網域與第一層子網域。多層 hostname 若沒有 Total TLS 或額外憑證，可能發生 HTTPS 憑證錯誤，因此平台預設拒絕。"],
	["DNS 修改多久生效？", "Cloudflare authoritative DNS 通常很快更新，但使用者端與遞迴 DNS 仍可能依原本 TTL 暫存舊答案。"],
	["如何清除網站快取？", "登入後到快取管理，優先使用 Purge URLs。只有需要擴大影響範圍時，再選 hostname 或 prefix。"],
	["權限移交給下一屆幹部怎麼做？", "請新幹部先用 GitHub 登入，再由管理員調整 namespace grant。權限變更後，舊 session 會自動撤銷。"]
] as const;

const dnsTypes = ["A", "AAAA", "CNAME", "TXT", "MX", "SRV", "CAA"] as const;

function FaqItem({ answer, index, question }: { readonly answer: string; readonly index: number; readonly question: string }) {
	const [open, setOpen] = useState(false);
	const answerId = `faq-answer-${index}`;
	const questionId = `faq-question-${index}`;

	return (
		<article className={styles.faqItem}>
			<h3 className={styles.faqQuestion}>
				<button className={styles.faqToggle} id={questionId} type="button" aria-controls={answerId} aria-expanded={open} onClick={() => setOpen(current => !current)}>
					<span>{question}</span>
					<ChevronDown aria-hidden="true" />
				</button>
			</h3>
			<div className={styles.faqAnswer} id={answerId} role="region" aria-hidden={!open} aria-labelledby={questionId} data-open={open}>
				<div className={styles.faqAnswerInner}>
					<p>{answer}</p>
				</div>
			</div>
		</article>
	);
}

export default function Landing() {
	return (
		<main id="main-content">
			<section className={styles.hero}>
				<div className={styles.heroCopy}>
					<p className={styles.maintainer}>
						交大軟體開發社維護
						<a href="https://sdc.nycu.club" rel="noreferrer" target="_blank">
							sdc.nycu.club <ExternalLink size={14} aria-hidden="true" />
						</a>
					</p>
					<h1>
						免費交大
						<br />
						社團子網域
					</h1>
					<p className={styles.lead}>
						管理自己的 <span translate="no">nycu.club</span> 子網域。只要是陽明交大社團都可以免費申請。
					</p>
					<div className={styles.heroActions}>
						<Link className="button buttonPrimary" to="/apply">
							申請子網域 <ArrowRight size={18} aria-hidden="true" />
						</Link>
						<Link className="button" to="/login">
							<GitFork size={18} aria-hidden="true" /> GitHub 登入
						</Link>
					</div>
				</div>

				<aside className={styles.namespaceCard} aria-label="Namespace 權限範圍示例">
					<span className={styles.cardLabel}>你的管理範圍</span>
					<code>magic.nycu.club</code>
					<ul>
						<li>
							<Check aria-hidden="true" />
							magic.nycu.club
						</li>
						<li>
							<Check aria-hidden="true" />
							www.magic.nycu.club
						</li>
						<li>
							<Check aria-hidden="true" />
							*.magic.nycu.club
						</li>
					</ul>
				</aside>
			</section>

			<section className={styles.manage} id="manage">
				<header className={styles.sectionHeader}>
					<h2>可以改什麼</h2>
					<p>管理 DNS、切換 Cloudflare Proxy，網站更新後也能直接清除快取。</p>
				</header>

				<div className={styles.actionGrid}>
					<article className={styles.actionCard} data-color="blue">
						<Database aria-hidden="true" />
						<h3>DNS Records</h3>
						<p>新增、編輯與刪除網站常用的 A、AAAA、CNAME、TXT、MX、SRV 與 CAA。</p>
					</article>
					<article className={styles.actionCard} data-color="yellow">
						<Cloud aria-hidden="true" />
						<h3>Cloudflare Proxy</h3>
						<p>一鍵切換 DNS only 與 Cloudflare Proxy，依網站需求使用 CDN 與加速功能。</p>
					</article>
					<article className={styles.actionCard} data-color="green">
						<RefreshCw aria-hidden="true" />
						<h3>Cache Purge</h3>
						<p>依 URL、hostname 或 prefix 清除快取，讓網站更新立即生效。</p>
					</article>
				</div>

				<div className={styles.typePanel}>
					<div>
						<ListPlus aria-hidden="true" />
						<h3>新增常用 DNS 記錄</h3>
						<p>支援網站、郵件、網域驗證與服務探索常用的 DNS 類型。</p>
					</div>
					<div className={styles.typeList} aria-label="支援的 DNS 類型">
						{dnsTypes.map(type => (
							<code key={type}>{type}</code>
						))}
					</div>
				</div>
			</section>

			<section className={styles.faq} id="faq">
				<header className={styles.sectionHeader}>
					<h2>常見問題</h2>
				</header>
				<div className={styles.faqList}>
					{faq.map(([question, answer], index) => (
						<FaqItem key={question} answer={answer} index={index} question={question} />
					))}
				</div>
				<div className={styles.applyCallout}>
					<h3>想使用 nycu.club？</h3>
					<p>填寫社團、用途與 GitHub username，軟體開發社會依聯絡方式回覆。</p>
					<Link className="button buttonPrimary" to="/apply">
						填寫申請表單
					</Link>
				</div>
			</section>
		</main>
	);
}
