import { AlertOctagon, Ban, CheckCircle2, Eraser, Link2, Server, Tags } from "lucide-react";
import { useState, type SyntheticEvent } from "react";

import { apiRequest } from "~/shared/client/api";
import { useToast } from "~/shared/components/feedback/ToastProvider";
import styles from "./CacheManager.module.css";

interface Props {
	readonly canPurgeEverything: boolean;
	readonly csrfToken: string;
	readonly grants: string[];
	readonly isAdmin: boolean;
	readonly zoneName: string;
}

type Tab = "hostnames" | "prefixes" | "urls";

export function CacheManager(props: Props) {
	const { showToast } = useToast();
	const [tab, setTab] = useState<Tab>("urls");
	const [value, setValue] = useState("");
	const [confirmation, setConfirmation] = useState("");
	const [busy, setBusy] = useState(false);
	const items = value
		.split("\n")
		.map(item => item.trim())
		.filter(Boolean);

	const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!items.length) return;
		const labels = { hostnames: "hostname", prefixes: "prefix", urls: "URL" } as const;
		if (!window.confirm(`確認清除以下 ${items.length} 個 ${labels[tab]}？\n\n${items.join("\n")}`)) return;
		setBusy(true);
		try {
			const key = tab === "urls" ? "urls" : tab;
			await apiRequest(`/api/v1/cache/purge/${tab}`, props.csrfToken, {
				body: { [key]: items },
				method: "POST"
			});
			showToast("Cloudflare cache purge 已送出", "success");
			setValue("");
		} catch (error) {
			showToast(error instanceof Error ? error.message : "Cache purge 失敗", "error");
		} finally {
			setBusy(false);
		}
	};

	const purgeEverything = async () => {
		if (confirmation !== `PURGE ${props.zoneName}`) return;
		if (!window.confirm("最後確認：這會清除 nycu.club 整個 zone 的所有 Cloudflare cache，可能造成大量回源。確定繼續？")) return;
		setBusy(true);
		try {
			await apiRequest("/api/v1/cache/purge/everything", props.csrfToken, {
				body: { confirmation },
				method: "POST"
			});
			showToast("已清除整個 zone cache", "success");
			setConfirmation("");
		} catch (error) {
			showToast(error instanceof Error ? error.message : "Purge everything 失敗", "error");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className={styles.layout}>
			<section className={`card ${styles.main}`}>
				<div className={styles.tabs} role="tablist" aria-label="Cache purge 類型">
					<button
						aria-selected={tab === "urls"}
						onClick={() => {
							setTab("urls");
							setValue("");
						}}
						role="tab"
						type="button"
					>
						<Link2 aria-hidden="true" />
						Purge URLs <span>建議</span>
					</button>
					<button
						aria-selected={tab === "hostnames"}
						onClick={() => {
							setTab("hostnames");
							setValue("");
						}}
						role="tab"
						type="button"
					>
						<Server aria-hidden="true" />
						Hostnames
					</button>
					<button
						aria-selected={tab === "prefixes"}
						onClick={() => {
							setTab("prefixes");
							setValue("");
						}}
						role="tab"
						type="button"
					>
						<Eraser aria-hidden="true" />
						Prefixes
					</button>
				</div>
				<form onSubmit={submit}>
					<div className={styles.tabIntro}>
						<h2>{tab === "urls" ? "清除精確 URL" : tab === "hostnames" ? "清除 hostname 的所有 cache" : "清除 path prefix"}</h2>
						<p>
							{tab === "urls"
								? "每行一個完整 http:// 或 https:// URL。這是影響範圍最小、最建議的選項。"
								: tab === "hostnames"
									? "每行一個 hostname；這會清除該 hostname 下的所有 URL。不可使用 wildcard。"
									: "每行使用 hostname/path，例如 magic.nycu.club/assets。系統會拒絕 encoded traversal 與 ..。"}
						</p>
					</div>
					<label className="field">
						<span className="fieldLabel">{tab === "urls" ? "URLs" : tab === "hostnames" ? "Hostnames" : "Prefixes"}</span>
						<textarea
							autoComplete="off"
							className="textarea"
							name={`purge-${tab}`}
							spellCheck={false}
							value={value}
							onChange={event => setValue(event.target.value)}
							placeholder={
								tab === "urls"
									? "https://magic.nycu.club/styles.css\nhttps://magic.nycu.club/app.js"
									: tab === "hostnames"
										? "magic.nycu.club\nassets.magic.nycu.club"
										: "magic.nycu.club/assets\nmagic.nycu.club/api"
							}
						/>
					</label>
					{items.length ? (
						<div className={styles.preview}>
							<b>即將清除 {items.length} 項</b>
							<ul>
								{items.map(item => (
									<li key={item}>
										<CheckCircle2 />
										{item}
									</li>
								))}
							</ul>
						</div>
					) : null}
					{tab !== "urls" ? (
						<div className={styles.warning}>
							<AlertOctagon />
							<span>
								<b>影響範圍較大</b>
								{tab === "hostnames" ? "Hostname purge 會清除該主機下所有已快取 URL。" : "Prefix purge 會清除所有以該 path 開頭的 URL。"}
							</span>
						</div>
					) : null}
					<button className="button buttonPrimary" disabled={busy || !items.length} type="submit">
						{busy ? "處理中…" : "確認並清除 cache"}
					</button>
				</form>
			</section>
			<aside className={styles.aside}>
				<section className="card">
					<h2>授權範圍</h2>
					{props.isAdmin ? (
						<p>
							<CheckCircle2 />
							Admin：所有非 protected hostname
						</p>
					) : (
						<ul>
							{props.grants.map(grant => (
								<li key={grant}>{grant}</li>
							))}
						</ul>
					)}
					<small>每一個 URL、hostname 與 prefix 都會在 server 端重新驗證。</small>
				</section>
				<section className={`card ${styles.noTags}`}>
					<Tags />
					<h2>不提供 cache tag purge</h2>
					<p>Tag 不一定能安全映射到 namespace，可能影響共享 zone 中其他社團網站，因此一般使用者不開放。</p>
				</section>
			</aside>
			{props.isAdmin ? (
				<section className={`card ${styles.dangerZone}`}>
					<AlertOctagon aria-hidden="true" />
					<div>
						<h2>Purge everything</h2>
						<p>清除 {props.zoneName} 整個 zone 的所有 cache。功能預設關閉，且有獨立的一分鐘一次 rate limit。</p>
					</div>
					{props.canPurgeEverything ? (
						<div className={styles.confirm}>
							<label className="field">
								<span className="fieldLabel">輸入 PURGE {props.zoneName}</span>
								<input autoComplete="off" className="input" name="purge-everything-confirmation" spellCheck={false} value={confirmation} onChange={event => setConfirmation(event.target.value)} />
							</label>
							<button className="button buttonDanger" disabled={busy || confirmation !== `PURGE ${props.zoneName}`} onClick={purgeEverything} type="button">
								Purge everything
							</button>
						</div>
					) : (
						<span className="statusPill" data-tone="warning">
							<Ban aria-hidden="true" />
							ENABLE_PURGE_EVERYTHING=false
						</span>
					)}
				</section>
			) : null}
		</div>
	);
}
