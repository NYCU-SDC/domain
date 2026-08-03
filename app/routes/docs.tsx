import { BookOpen, Database, KeyRound, RefreshCw, ShieldCheck } from "lucide-react";
import { Link } from "react-router";

import type { Route } from "./+types/docs";
import styles from "./public-info.module.css";

export const meta: Route.MetaFunction = () => [
  { title: "使用說明｜nycu.club" },
  { name: "description", content: "nycu.club DNS、Proxy 與 cache 管理使用說明。" },
];

export default function DocsPage() {
  return (
    <main className={styles.page} id="main-content">
      <nav className={styles.nav} aria-label="頁面導覽">
        <Link className="brand" to="/"><span className="brandMark">N</span>nycu.club</Link>
        <Link className="button buttonPrimary" to="/login">GitHub 登入</Link>
      </nav>
      <article className={styles.content}>
        <p className="eyebrow">GETTING STARTED</p>
        <h1>安全管理社團 DNS 與 cache</h1>
        <p className={styles.lead}>先使用 GitHub 登入，再由管理員配置 namespace。Grant 會包含 namespace apex 與其下所有子網域，但不會延伸到名稱相似的其他社團。</p>
        <div className={styles.grid}>
          <article className="card"><h2><KeyRound aria-hidden="true" />1. 登入與申請權限</h2><p>第一次登入會建立 pending identity。把 GitHub username、社團與預計使用的 namespace 提供給管理員；核准後重新登入。</p></article>
          <article className="card"><h2><Database aria-hidden="true" />2. 建立 DNS record</h2><p>選擇 namespace 後用相對 Name，例如 <code>@</code>、<code>www</code>、<code>_acme-challenge</code> 或 <code>*.dev</code>。介面會顯示完整 FQDN；後端仍會 canonicalize 並重新授權。</p></article>
          <article className="card"><h2><ShieldCheck aria-hidden="true" />3. 選擇 Proxy</h2><p>A、AAAA、CNAME 才能開啟 Proxy。多層子網域若沒有適當 TLS certificate coverage，請保持 DNS only 並請管理員確認。</p></article>
          <article className="card"><h2><RefreshCw aria-hidden="true" />4. 清除 cache</h2><p>優先使用 Purge URLs，把影響範圍縮到需要更新的資源；hostname 與 prefix purge 會影響更多內容，送出前請逐項確認。</p></article>
          <article className="card"><h2><BookOpen aria-hidden="true" />需要 NS delegation？</h2><p>NS 可能繞過平台的 namespace 與 audit 控制，因此不開放自行建立。需要完整 delegation 或其他未開放 record type 時，請聯絡系統管理員。</p></article>
        </div>
      </article>
    </main>
  );
}
