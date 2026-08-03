import {
  Activity,
  ArrowRight,
  CheckCircle2,
  CloudCog,
  DatabaseZap,
  GitFork,
  KeyRound,
  ListChecks,
  LockKeyhole,
  Network,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Link } from "react-router";

import type { Route } from "./+types/landing";
import styles from "./landing.module.css";

export const meta: Route.MetaFunction = () => [
  { title: "nycu.club｜給陽明交大社團的子網域管理平台" },
  {
    name: "description",
    content:
      "使用 GitHub 登入，依社團 namespace 安全管理 nycu.club DNS、Cloudflare Proxy 與 cache purge。",
  },
];

const features = [
  { icon: Network, title: "Namespace 權限", text: "權限精準綁定 DNS label boundary，包含所屬的所有深層子網域。" },
  { icon: DatabaseZap, title: "DNS 即時管理", text: "直接讀取 Cloudflare source of truth，不在資料庫維護容易過期的副本。" },
  { icon: CloudCog, title: "Proxy 設定", text: "只在支援類型顯示 Proxy，深層子網域另有 TLS 憑證防護政策。" },
  { icon: RefreshCw, title: "Cache purge", text: "依 URL、hostname 或 prefix 清除，且每個目標都會再次驗證 namespace。" },
  { icon: ListChecks, title: "完整 audit log", text: "成功、失敗、拒絕操作都保留 request ID、actor、before 與 after。" },
  { icon: ShieldCheck, title: "集中安全控管", text: "Cloudflare Token 留在 Worker secret，前端永遠無法取得 account credential。" },
];

const faq = [
  ["誰可以使用？", "使用 GitHub 登入後，由系統管理員核准的陽明交大社團網站維護者可以使用。未核准帳號只會看到等待授權頁面。"],
  ["如何取得子網域權限？", "先登入一次讓帳號出現在 pending 清單，再請系統管理員確認社團與維護者身分並配置 namespace。"],
  ["magic.nycu.club 的權限是否包含更深層子網域？", "是。它包含 magic.nycu.club、www.magic.nycu.club、api.dev.magic.nycu.club 等，但不包含 evilmagic.nycu.club。"],
  ["為什麼不能新增 NS？", "NS 會把整個子網域委派到其他 nameserver，可能繞過本平台的權限與 audit 控制；如需完整 delegation，請聯絡系統管理員。"],
  ["什麼是 Cloudflare Proxy？", "Proxy 會讓 HTTP 流量經過 Cloudflare，使用其 CDN、安全與 TLS 功能。DNS only 則只回傳原始 DNS 答案。"],
  ["為什麼某些深層子網域不能開啟 Proxy？", "一般 Universal SSL 通常只涵蓋根網域與第一層子網域。多層 hostname 若沒有 Total TLS 或額外憑證，可能產生 HTTPS 憑證錯誤。"],
  ["DNS 修改多久生效？", "Cloudflare 通常很快更新 authoritative DNS，但用戶端與遞迴 DNS 仍可能依舊的 TTL 暫存答案。"],
  ["如何清除網站快取？", "登入後到「快取管理」，優先使用 Purge URLs；需要擴大範圍時再選 hostname 或 prefix，確認清單後送出。"],
  ["權限移交給下一屆社團幹部時怎麼做？", "請新幹部先登入，管理員再移轉 grant 並撤銷舊幹部 sessions。每次權限變更都會強制重新登入並留下 audit。"],
] as const;

export default function Landing() {
  return (
    <div className={styles.page} id="top">
      <header className={styles.header}>
        <nav className={styles.nav} aria-label="主要導覽">
          <a className="brand" href="#top">
            <span className="brandMark" aria-hidden="true">N</span>
            nycu.club
          </a>
          <div className={styles.navLinks}>
            <a href="#features">功能說明</a>
            <a href="#types">支援類型</a>
            <a href="#faq">常見問題</a>
          </div>
          <Link className="button buttonPrimary buttonSmall" to="/login">
            <GitFork size={17} aria-hidden="true" /> GitHub 登入
          </Link>
        </nav>
      </header>

      <main id="main-content">
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <p className="eyebrow">NYCU CLUB INFRASTRUCTURE</p>
            <h1>給陽明交大社團的<br /><span>子網域管理平台</span></h1>
            <p className={styles.heroLead}>
              使用 GitHub 帳號登入，由管理員配置社團 namespace。社團幹部可以自行管理 DNS、Proxy 與快取，卻不需要取得整個 Cloudflare account 權限。
            </p>
            <div className={styles.heroActions}>
              <Link className="button buttonPrimary" to="/login">
                <GitFork size={19} aria-hidden="true" /> 使用 GitHub 登入
              </Link>
              <a className="button" href="#flow">查看使用方式 <ArrowRight size={18} aria-hidden="true" /></a>
            </div>
            <ul className={styles.trustList} aria-label="平台特點">
              <li><CheckCircle2 size={17} aria-hidden="true" /> 最小權限</li>
              <li><CheckCircle2 size={17} aria-hidden="true" /> 每筆變更可追蹤</li>
              <li><CheckCircle2 size={17} aria-hidden="true" /> Cloudflare 即時資料</li>
            </ul>
          </div>
          <div className={styles.consolePreview} aria-label="Namespace 權限示意">
            <div className={styles.previewTop}><span /><span /><span /><strong>namespace policy</strong></div>
            <div className={styles.previewBody}>
              <p className={styles.previewLabel}>GRANT</p>
              <code>magic.nycu.club</code>
              <div className={styles.boundary}>
                <p><CheckCircle2 size={16} /> magic.nycu.club</p>
                <p><CheckCircle2 size={16} /> www.magic.nycu.club</p>
                <p><CheckCircle2 size={16} /> *.magic.nycu.club</p>
              </div>
              <div className={styles.denied}><LockKeyhole size={16} /> evilmagic.nycu.club <b>DENIED</b></div>
            </div>
          </div>
        </section>

        <section className={styles.flow} id="flow">
          <div className={styles.sectionHeading}>
            <p className="eyebrow">三個步驟</p>
            <h2>從登入到上線，權限邊界始終清楚</h2>
          </div>
          <ol className={styles.steps}>
            <li><span>01</span><GitFork aria-hidden="true" /><h3>使用 GitHub 登入</h3><p>只讀取辨識身分需要的 public profile，不要求 repository 或 organization 管理權。</p></li>
            <li><span>02</span><Users aria-hidden="true" /><h3>配置 namespace</h3><p>管理員依社團配置可管理範圍，權限會涵蓋 namespace 下的所有子網域。</p></li>
            <li><span>03</span><CloudCog aria-hidden="true" /><h3>安全管理基礎設施</h3><p>建立 DNS record、切換 Proxy 或清除快取；所有 mutation 由 Worker 重新授權。</p></li>
          </ol>
        </section>

        <section className={styles.features} id="features">
          <div className={styles.sectionHeading}>
            <p className="eyebrow">CONTROL PLANE</p>
            <h2>讓社團有自主性，也保留平台級安全控制</h2>
          </div>
          <div className={styles.featureGrid}>
            {features.map(({ icon: Icon, text, title }) => (
              <article className={styles.featureCard} key={title}>
                <span className={styles.iconBox}><Icon aria-hidden="true" /></span>
                <h3>{title}</h3><p>{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.types} id="types">
          <div>
            <p className="eyebrow">DNS WHITELIST</p>
            <h2>只開放能被完整驗證的 DNS 類型</h2>
            <p>每一種 record 都有專屬欄位與 server-side schema。高風險 delegation 與 DNSSEC 記錄不會出現在可寫 API。</p>
          </div>
          <div className={styles.typeList} aria-label="支援的 DNS 類型">
            {(["A", "AAAA", "CNAME", "TXT", "MX", "SRV", "CAA"] as const).map((type) => <span key={type}>{type}</span>)}
          </div>
        </section>

        <section className={styles.security}>
          <div className={styles.securityGraphic}><KeyRound size={44} aria-hidden="true" /><span>Cloudflare Token</span><small>Worker secret only</small></div>
          <div>
            <p className="eyebrow">SECURITY BY DEFAULT</p>
            <h2>社團永遠不會拿到 Cloudflare Token</h2>
            <p>瀏覽器只和同一個 Worker 溝通；Cloudflare API request 一律經過固定 method 白名單、資料驗證、權限判斷與 audit。</p>
            <ul>
              <li><ShieldCheck size={18} /> namespace boundary validation</li>
              <li><ShieldCheck size={18} /> DNS type whitelist</li>
              <li><ShieldCheck size={18} /> protected hostname policy</li>
              <li><ShieldCheck size={18} /> audit log 與 request ID</li>
              <li><ShieldCheck size={18} /> per-user rate limit</li>
              <li><ShieldCheck size={18} /> server-side validation</li>
            </ul>
          </div>
        </section>

        <section className={styles.faq} id="faq">
          <div className={styles.sectionHeading}>
            <p className="eyebrow">FAQ</p>
            <h2>常見問題</h2>
          </div>
          <div className={styles.faqList}>
            {faq.map(([question, answer]) => (
              <details key={question}><summary>{question}</summary><p>{answer}</p></details>
            ))}
          </div>
        </section>

        <section className={styles.finalCta}>
          <Activity aria-hidden="true" />
          <div><h2>準備好管理社團網站了嗎？</h2><p>登入後若尚未取得權限，系統會引導你聯絡管理員。</p></div>
          <Link className="button buttonPrimary" to="/login">開始使用 <ArrowRight size={18} /></Link>
        </section>
      </main>

      <footer className={styles.footer}>
        <div><a className="brand" href="#top"><span className="brandMark">N</span>nycu.club</a><p>由軟體開發社維護的校園基礎設施服務。</p></div>
        <div><h2>資源</h2><span>GitHub repository（待公開）</span><a href="/security">隱私與安全說明</a><a href="/status">系統狀態</a></div>
        <div><h2>平台</h2><Link to="/login">GitHub 登入</Link><a href="#types">支援的 DNS 類型</a><a href="#faq">常見問題</a></div>
        <small>© {new Date().getUTCFullYear()} NYCU Software Development Club</small>
      </footer>
    </div>
  );
}
