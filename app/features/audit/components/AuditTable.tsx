import { ChevronRight, FileJson, Search, X } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { useDialogFocus } from "~/shared/client/useDialogFocus";
import { EmptyState } from "~/shared/components/feedback/EmptyState";
import { DataTableFrame } from "~/shared/components/table/DataTableFrame";
import styles from "./AuditTable.module.css";

interface AuditItem {
	readonly action: string;
	readonly afterJson: string | null;
	readonly beforeJson: string | null;
	readonly createdAt: number;
	readonly errorCode: string | null;
	readonly errorMessage: string | null;
	readonly hostname: string | null;
	readonly id: string;
	readonly namespace: string | null;
	readonly requestId: string;
	readonly status: string;
	readonly targetId: string | null;
	readonly targetType: string | null;
}

function formatTime(timestamp: number): string {
	return new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Taipei" }).format(timestamp);
}

function prettyJson(value: string | null): string {
	if (!value) return "null";
	try {
		return JSON.stringify(JSON.parse(value) as unknown, null, 2);
	} catch {
		return "[無法解析]";
	}
}

export function AuditTable({ items }: { readonly items: AuditItem[] }) {
	const [search, setSearch] = useState("");
	const [status, setStatus] = useState("all");
	const [selected, setSelected] = useState<AuditItem | null>(null);
	const drawerRef = useRef<HTMLElement>(null);
	const closeDrawer = useCallback(() => setSelected(null), []);
	useDialogFocus(Boolean(selected), drawerRef, closeDrawer);
	const filtered = useMemo(
		() =>
			items.filter(item => {
				const matchSearch = `${item.action} ${item.hostname ?? ""} ${item.namespace ?? ""} ${item.requestId}`.toLowerCase().includes(search.toLowerCase());
				return matchSearch && (status === "all" || item.status === status);
			}),
		[items, search, status]
	);
	return (
		<section>
			<div className={styles.filters}>
				<label>
					<Search aria-hidden="true" />
					<span className="srOnly">搜尋操作紀錄</span>
					<input autoComplete="off" name="audit-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Action、hostname 或 request ID…" />
				</label>
				<select aria-label="Status filter" name="audit-status" value={status} onChange={event => setStatus(event.target.value)}>
					<option value="all">全部狀態</option>
					<option value="success">Success</option>
					<option value="denied">Denied</option>
					<option value="error">Error</option>
				</select>
			</div>
			{filtered.length ? (
				<DataTableFrame className={styles.table}>
					<table>
						<caption className="srOnly">操作紀錄</caption>
						<thead>
							<tr>
								<th scope="col">時間</th>
								<th scope="col">Action</th>
								<th scope="col">Target</th>
								<th scope="col">Namespace</th>
								<th scope="col">Status</th>
								<th scope="col">Request ID</th>
								<th scope="col">
									<span className="srOnly">詳細資料</span>
								</th>
							</tr>
						</thead>
						<tbody>
							{filtered.map(item => (
								<tr key={item.id}>
									<td>
										<time dateTime={new Date(item.createdAt).toISOString()}>{formatTime(item.createdAt)}</time>
									</td>
									<td>
										<b>{item.action}</b>
									</td>
									<td>{item.hostname ?? item.targetId ?? "—"}</td>
									<td>
										<code>{item.namespace ?? "—"}</code>
									</td>
									<td>
										<span className="statusPill" data-tone={item.status === "success" ? "success" : item.status === "denied" ? "danger" : "warning"}>
											{item.status}
										</span>
									</td>
									<td>
										<code className={styles.requestId}>{item.requestId}</code>
									</td>
									<td>
										<button aria-label={`查看 ${item.action} JSON detail`} onClick={() => setSelected(item)} title="查看 JSON detail" type="button">
											<ChevronRight aria-hidden="true" />
										</button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</DataTableFrame>
			) : (
				<EmptyState title="沒有符合條件的操作紀錄" description="調整搜尋或 status filter 後再試。" />
			)}
			{selected ? (
				<div className={styles.drawerBackdrop}>
					<aside aria-labelledby="audit-detail-title" aria-modal="true" className={styles.drawer} ref={drawerRef} role="dialog" tabIndex={-1}>
						<header>
							<h2 id="audit-detail-title">{selected.action}</h2>
							<button onClick={closeDrawer} aria-label="關閉" type="button">
								<X aria-hidden="true" />
							</button>
						</header>
						<dl>
							<div>
								<dt>Time</dt>
								<dd>{formatTime(selected.createdAt)}</dd>
							</div>
							<div>
								<dt>Status</dt>
								<dd>{selected.status}</dd>
							</div>
							<div>
								<dt>Request ID</dt>
								<dd>
									<code>{selected.requestId}</code>
								</dd>
							</div>
							<div>
								<dt>Target</dt>
								<dd>
									{selected.targetType ?? "—"} / {selected.targetId ?? "—"}
								</dd>
							</div>
							<div>
								<dt>Hostname</dt>
								<dd>{selected.hostname ?? "—"}</dd>
							</div>
							{selected.errorCode ? (
								<div>
									<dt>Error</dt>
									<dd>
										{selected.errorCode}: {selected.errorMessage}
									</dd>
								</div>
							) : null}
						</dl>
						<section>
							<h3>
								<FileJson aria-hidden="true" />
								Before
							</h3>
							<pre>{prettyJson(selected.beforeJson)}</pre>
						</section>
						<section>
							<h3>
								<FileJson aria-hidden="true" />
								After
							</h3>
							<pre>{prettyJson(selected.afterJson)}</pre>
						</section>
					</aside>
				</div>
			) : null}
		</section>
	);
}
