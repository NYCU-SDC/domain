import { Check, Clipboard, Cloud, CloudOff, FilePenLine, Filter, Plus, RefreshCw, Search, ShieldAlert, Trash2, X } from "lucide-react";
import { useCallback, useMemo, useRef, useState, type SyntheticEvent } from "react";

import { apiRequest } from "~/shared/client/api";
import { useDialogFocus } from "~/shared/client/useDialogFocus";
import { EmptyState } from "~/shared/components/feedback/EmptyState";
import { useToast } from "~/shared/components/feedback/ToastProvider";
import { DataTableFrame } from "~/shared/components/table/DataTableFrame";
import { allowedDnsTypes, unsupportedDnsTypeReasons, type AllowedDnsType } from "~/shared/lib/dns/records";
import styles from "./DnsManager.module.css";

const proxyTypes: readonly AllowedDnsType[] = ["A", "AAAA", "CNAME"];

interface RecordView {
	readonly content: string | null;
	readonly data: Record<string, unknown> | null;
	readonly id: string;
	readonly name: string;
	readonly namespace: string | null;
	readonly priority: number | null;
	readonly protected: boolean;
	readonly proxiable: boolean;
	readonly proxied: boolean;
	readonly ttl: number;
	readonly type: string;
}

interface Props {
	readonly allowProxiedDeepSubdomains: boolean;
	readonly csrfToken: string;
	readonly error: string | null;
	readonly grants: string[];
	readonly isAdmin: boolean;
	readonly records: RecordView[];
	readonly requestId: string;
	readonly zoneName: string;
}

interface FormState {
	flags: string;
	name: string;
	namespace: string;
	port: string;
	priority: string;
	protocol: string;
	proxied: boolean;
	service: string;
	tag: "iodef" | "issue" | "issuewild";
	target: string;
	ttl: string;
	type: AllowedDnsType;
	value: string;
	weight: string;
}

const emptyForm = (namespace: string): FormState => ({
	flags: "0",
	name: "@",
	namespace,
	port: "443",
	priority: "10",
	protocol: "tcp",
	proxied: false,
	service: "https",
	tag: "issue",
	target: "",
	ttl: "1",
	type: "A",
	value: "",
	weight: "0"
});

function dataString(data: Record<string, unknown> | null, key: string): string {
	const value = data?.[key];
	return typeof value === "string" ? value : "";
}

function dataNumber(data: Record<string, unknown> | null, key: string): string {
	const value = data?.[key];
	return typeof value === "number" ? String(value) : "0";
}

function caaTag(data: Record<string, unknown> | null): FormState["tag"] {
	const value = dataString(data, "tag");
	return value === "iodef" || value === "issuewild" ? value : "issue";
}

function inferNamespace(name: string, zoneName: string): string {
	const zoneLabels = zoneName.split(".").length;
	return name
		.split(".")
		.slice(-(zoneLabels + 1))
		.join(".");
}

function relativeName(name: string, namespace: string): string {
	if (name === namespace) return "@";
	return name.endsWith(`.${namespace}`) ? name.slice(0, -1 * `.${namespace}`.length) : name;
}

function valueForRecord(record: RecordView): string {
	if (record.type === "SRV") {
		return `${dataString(record.data, "priority")} ${dataString(record.data, "weight")} ${dataString(record.data, "port")} ${dataString(record.data, "target")}`.trim();
	}
	if (record.type === "CAA") {
		return `${dataNumber(record.data, "flags")} ${dataString(record.data, "tag")} ${dataString(record.data, "value")}`.trim();
	}
	return record.content ?? "—";
}

export function DnsManager(props: Props) {
	const { showToast } = useToast();
	const [search, setSearch] = useState("");
	const [typeFilter, setTypeFilter] = useState("all");
	const [proxyFilter, setProxyFilter] = useState("all");
	const [page, setPage] = useState(1);
	const [modalOpen, setModalOpen] = useState(false);
	const [editing, setEditing] = useState<RecordView | null>(null);
	const [form, setForm] = useState<FormState>(() => emptyForm(props.grants[0] ?? ""));
	const [busy, setBusy] = useState(false);
	const modalRef = useRef<HTMLElement>(null);
	const closeModal = useCallback(() => setModalOpen(false), []);
	useDialogFocus(modalOpen, modalRef, closeModal);

	const filtered = useMemo(
		() =>
			props.records.filter(record => {
				const matchesSearch = `${record.name} ${valueForRecord(record)}`.toLowerCase().includes(search.toLowerCase());
				const matchesType = typeFilter === "all" || record.type === typeFilter;
				const matchesProxy = proxyFilter === "all" || record.proxied === (proxyFilter === "yes");
				return matchesSearch && matchesType && matchesProxy;
			}),
		[props.records, proxyFilter, search, typeFilter]
	);
	const pageCount = Math.max(1, Math.ceil(filtered.length / 25));
	const visible = filtered.slice((page - 1) * 25, page * 25);

	const openCreate = () => {
		setEditing(null);
		setForm(emptyForm(props.grants[0] ?? ""));
		setModalOpen(true);
	};

	const openEdit = (record: RecordView) => {
		const namespace = record.namespace ?? inferNamespace(record.name, props.zoneName);
		const baseName = record.type === "SRV" ? dataString(record.data, "name") || record.name : record.name;
		const type = record.type as AllowedDnsType;
		setEditing(record);
		setForm({
			flags: dataNumber(record.data, "flags"),
			name: relativeName(baseName, namespace),
			namespace,
			port: dataNumber(record.data, "port"),
			priority: String(record.priority ?? (Number(dataNumber(record.data, "priority")) || 10)),
			protocol: dataString(record.data, "proto").replace(/^_/u, "") || "tcp",
			proxied: record.proxied,
			service: dataString(record.data, "service").replace(/^_/u, "") || "https",
			tag: caaTag(record.data),
			target: type === "CNAME" || type === "MX" ? (record.content ?? "") : dataString(record.data, "target"),
			ttl: String(record.ttl),
			type,
			value: type === "A" || type === "AAAA" || type === "TXT" ? (record.content ?? "") : dataString(record.data, "value"),
			weight: dataNumber(record.data, "weight")
		});
		setModalOpen(true);
	};

	const updateForm = <K extends keyof FormState>(key: K, value: FormState[K]) => {
		setForm(current => ({ ...current, [key]: value }));
	};

	const updateType = (type: AllowedDnsType) => {
		setForm(current => ({
			...current,
			proxied: proxyTypes.includes(type) ? current.proxied : false,
			type
		}));
	};

	const preview = form.namespace ? (form.name === "@" ? form.namespace : `${form.name}.${form.namespace}`) : "請先選擇 namespace";
	const deepProxy = form.proxied && form.namespace.length > 0 && (form.name !== "@" || form.name.startsWith("*"));

	const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
		event.preventDefault();
		setBusy(true);
		try {
			const base = {
				name: form.name,
				namespace: form.namespace,
				proxied: ["A", "AAAA", "CNAME"].includes(form.type) ? form.proxied : false,
				ttl: Number(form.ttl),
				type: form.type
			};
			let payload: Record<string, unknown>;
			switch (form.type) {
				case "A":
				case "AAAA":
				case "TXT":
					payload = { ...base, content: form.value };
					break;
				case "CNAME":
					payload = { ...base, target: form.target };
					break;
				case "MX":
					payload = { ...base, priority: Number(form.priority), target: form.target };
					break;
				case "SRV":
					payload = {
						...base,
						port: Number(form.port),
						priority: Number(form.priority),
						protocol: form.protocol,
						service: form.service,
						target: form.target,
						weight: Number(form.weight)
					};
					break;
				case "CAA":
					payload = {
						...base,
						flags: Number(form.flags),
						tag: form.tag,
						value: form.value
					};
					break;
			}
			await apiRequest(editing ? `/api/v1/dns-records/${editing.id}` : "/api/v1/dns-records", props.csrfToken, { body: payload, method: editing ? "PATCH" : "POST" });
			showToast(editing ? "DNS record 已更新" : "DNS record 已建立", "success");
			setModalOpen(false);
			window.location.reload();
		} catch (error) {
			showToast(error instanceof Error ? error.message : "DNS 操作失敗", "error");
		} finally {
			setBusy(false);
		}
	};

	const remove = async (record: RecordView) => {
		const highImpact = ["CAA", "MX"].includes(record.type) || record.name.startsWith("*.");
		const message = `確定刪除 ${record.type} ${record.name}？\n\n${valueForRecord(record)}${highImpact ? "\n\n這是高影響記錄，可能中斷郵件、TLS 或大量子網域。" : ""}`;
		if (!window.confirm(message)) return;
		try {
			await apiRequest(`/api/v1/dns-records/${record.id}`, props.csrfToken, {
				body: {},
				method: "DELETE"
			});
			showToast("DNS record 已刪除", "success");
			window.location.reload();
		} catch (error) {
			showToast(error instanceof Error ? error.message : "刪除失敗", "error");
		}
	};

	const copy = async (value: string) => {
		await navigator.clipboard.writeText(value);
		showToast("已複製到剪貼簿", "success");
	};

	return (
		<section>
			{props.error ? (
				<div className={styles.errorState} role="alert">
					<ShieldAlert aria-hidden="true" />
					<span>
						{props.error}
						<small>Request ID: {props.requestId}</small>
					</span>
					<button className="button" onClick={() => window.location.reload()} type="button">
						<RefreshCw aria-hidden="true" />
						重新整理
					</button>
				</div>
			) : null}
			<div className={styles.toolbar}>
				<label className={styles.search}>
					<Search aria-hidden="true" />
					<span className="srOnly">搜尋 hostname 或內容</span>
					<input
						autoComplete="off"
						name="dns-search"
						spellCheck={false}
						value={search}
						onChange={event => {
							setSearch(event.target.value);
							setPage(1);
						}}
						placeholder="搜尋 hostname 或 content…"
					/>
				</label>
				<label>
					<Filter aria-hidden="true" />
					<span className="srOnly">DNS type filter</span>
					<select
						name="dns-type-filter"
						value={typeFilter}
						onChange={event => {
							setTypeFilter(event.target.value);
							setPage(1);
						}}
					>
						<option value="all">全部類型</option>
						{["A", "AAAA", "CNAME", "TXT", "MX", "SRV", "CAA"].map(type => (
							<option key={type}>{type}</option>
						))}
					</select>
				</label>
				<label>
					<Cloud aria-hidden="true" />
					<span className="srOnly">Proxy filter</span>
					<select
						name="dns-proxy-filter"
						value={proxyFilter}
						onChange={event => {
							setProxyFilter(event.target.value);
							setPage(1);
						}}
					>
						<option value="all">全部 Proxy 狀態</option>
						<option value="yes">Proxied</option>
						<option value="no">DNS only</option>
					</select>
				</label>
				<button className="button" onClick={() => window.location.reload()} type="button">
					<RefreshCw size={17} /> Refresh
				</button>
				<button className="button buttonPrimary" onClick={openCreate} type="button">
					<Plus size={18} /> 建立 record
				</button>
			</div>

			{visible.length ? (
				<DataTableFrame className={styles.tableWrap}>
					<table>
						<caption className="srOnly">可管理的 DNS records</caption>
						<thead>
							<tr>
								<th scope="col">Type</th>
								<th scope="col">Name</th>
								<th scope="col">Content / Target</th>
								<th scope="col">Proxy</th>
								<th scope="col">TTL</th>
								<th scope="col">Namespace</th>
								<th scope="col">
									<span className="srOnly">Actions</span>
								</th>
							</tr>
						</thead>
						<tbody>
							{visible.map(record => (
								<tr key={record.id}>
									<td>
										<span className={styles.typeBadge}>{record.type}</span>
										{record.protected ? (
											<span className="statusPill" data-tone="warning">
												Protected
											</span>
										) : null}
									</td>
									<td>
										<button className={styles.copyValue} onClick={() => copy(record.name)} title="複製 hostname" type="button">
											<code>{record.name}</code>
											<Clipboard aria-hidden="true" />
										</button>
									</td>
									<td>
										<button className={styles.copyValue} onClick={() => copy(valueForRecord(record))} title="複製內容" type="button">
											<span>{valueForRecord(record)}</span>
											<Clipboard aria-hidden="true" />
										</button>
									</td>
									<td>
										{record.proxied ? (
											<span className="statusPill" data-tone="success">
												<Cloud aria-hidden="true" />
												Proxied
											</span>
										) : (
											<span className="statusPill">
												<CloudOff aria-hidden="true" />
												DNS only
											</span>
										)}
									</td>
									<td>{record.ttl === 1 ? "Auto" : `${record.ttl}s`}</td>
									<td>
										<span className={styles.namespace}>{record.namespace ?? (props.isAdmin ? "Admin / zone" : "—")}</span>
									</td>
									<td>
										<div className={styles.actions}>
											<button
												aria-label={`編輯 ${record.type} ${record.name}`}
												disabled={record.protected || !["A", "AAAA", "CNAME", "TXT", "MX", "SRV", "CAA"].includes(record.type)}
												onClick={() => openEdit(record)}
												title="編輯"
												type="button"
											>
												<FilePenLine aria-hidden="true" />
											</button>
											<button
												aria-label={`刪除 ${record.type} ${record.name}`}
												disabled={record.protected || !["A", "AAAA", "CNAME", "TXT", "MX", "SRV", "CAA"].includes(record.type)}
												onClick={() => remove(record)}
												title="刪除"
												type="button"
											>
												<Trash2 aria-hidden="true" />
											</button>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
					<div className={styles.pagination}>
						<span>
							共 {filtered.length} 筆，第 {page} / {pageCount} 頁
						</span>
						<div>
							<button className="button buttonSmall" disabled={page <= 1} onClick={() => setPage(current => current - 1)} type="button">
								上一頁
							</button>
							<button className="button buttonSmall" disabled={page >= pageCount} onClick={() => setPage(current => current + 1)} type="button">
								下一頁
							</button>
						</div>
					</div>
				</DataTableFrame>
			) : (
				<EmptyState
					title="沒有符合條件的 DNS record"
					description={props.records.length ? "請調整搜尋或篩選條件。" : "這個 namespace 目前沒有可管理的 DNS record。"}
					action={
						<button className="button buttonPrimary" onClick={openCreate} type="button">
							<Plus aria-hidden="true" />
							建立第一筆 record
						</button>
					}
				/>
			)}

			<details className={styles.unsupported}>
				<summary>為什麼不能設定其他 DNS 類型？</summary>
				<div>
					{Object.entries(unsupportedDnsTypeReasons).map(([type, reason]) => (
						<article key={type}>
							<b>{type}</b>
							<p>{reason}</p>
						</article>
					))}
				</div>
			</details>

			{modalOpen ? (
				<div className={styles.modalBackdrop} role="presentation">
					<section className={styles.modal} ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="dns-form-title" tabIndex={-1}>
						<header>
							<h2 id="dns-form-title">{editing ? `編輯 ${editing.name}` : "建立 DNS record"}</h2>
							<button onClick={closeModal} aria-label="關閉" type="button">
								<X aria-hidden="true" />
							</button>
						</header>
						<form onSubmit={submit}>
							<div className={styles.formGrid}>
								<div className="field">
									<label htmlFor="record-type">Type</label>
									<select className="select" id="record-type" name="type" value={form.type} onChange={event => updateType(event.target.value as AllowedDnsType)}>
										{allowedDnsTypes.map(type => (
											<option key={type}>{type}</option>
										))}
									</select>
								</div>
								<div className="field">
									<label htmlFor="record-namespace">Namespace</label>
									{props.isAdmin ? (
										<input
											autoComplete="off"
											className="input"
											id="record-namespace"
											name="namespace"
											required
											spellCheck={false}
											value={form.namespace}
											placeholder={`magic.${props.zoneName}…`}
											onChange={event => updateForm("namespace", event.target.value)}
										/>
									) : (
										<select className="select" id="record-namespace" name="namespace" required value={form.namespace} onChange={event => updateForm("namespace", event.target.value)}>
											<option value="" disabled>
												選擇 namespace
											</option>
											{props.grants.map(grant => (
												<option key={grant}>{grant}</option>
											))}
										</select>
									)}
									<p className="helpText">包含此 namespace 下的所有子網域。</p>
								</div>
								<div className="field">
									<label htmlFor="record-name">Name</label>
									<input
										autoComplete="off"
										className="input"
										id="record-name"
										name="name"
										required
										spellCheck={false}
										value={form.name}
										onChange={event => updateForm("name", event.target.value)}
										placeholder="@、www、*、*.dev…"
									/>
									<p className="helpText">
										完整結果：<code>{preview}</code>
									</p>
								</div>
								{form.type === "A" || form.type === "AAAA" || form.type === "TXT" ? (
									<div className="field">
										<label htmlFor="record-value">{form.type === "TXT" ? "TXT content" : "IP address"}</label>
										<textarea
											autoComplete="off"
											className={form.type === "TXT" ? "textarea" : "input"}
											id="record-value"
											name="value"
											required
											spellCheck={false}
											value={form.value}
											onChange={event => updateForm("value", event.target.value)}
										/>
										{form.type === "TXT" ? <p className="helpText">請貼上原始字串；平台不會自行加入或重複加入引號。長內容可能被 DNS client 分段顯示。</p> : null}
									</div>
								) : null}
								{form.type === "CNAME" || form.type === "MX" ? (
									<div className="field">
										<label htmlFor="record-target">Target FQDN</label>
										<input
											autoComplete="off"
											className="input"
											id="record-target"
											name="target"
											required
											spellCheck={false}
											value={form.target}
											onChange={event => updateForm("target", event.target.value)}
											placeholder="target.example.com…"
										/>
									</div>
								) : null}
								{form.type === "MX" ? (
									<div className="field">
										<label htmlFor="record-priority">Priority</label>
										<input
											className="input"
											id="record-priority"
											name="priority"
											type="number"
											min="0"
											max="65535"
											required
											value={form.priority}
											onChange={event => updateForm("priority", event.target.value)}
										/>
									</div>
								) : null}
								{form.type === "SRV" ? (
									<>
										<div className="field">
											<label htmlFor="srv-service">Service</label>
											<input
												autoComplete="off"
												className="input"
												id="srv-service"
												name="service"
												required
												spellCheck={false}
												value={form.service}
												onChange={event => updateForm("service", event.target.value)}
												placeholder="https…"
											/>
										</div>
										<div className="field">
											<label htmlFor="srv-protocol">Protocol</label>
											<select className="select" id="srv-protocol" name="protocol" value={form.protocol} onChange={event => updateForm("protocol", event.target.value)}>
												<option>tcp</option>
												<option>udp</option>
												<option>tls</option>
											</select>
										</div>
										<div className="field">
											<label htmlFor="srv-priority">Priority</label>
											<input
												className="input"
												id="srv-priority"
												name="priority"
												type="number"
												min="0"
												max="65535"
												value={form.priority}
												onChange={event => updateForm("priority", event.target.value)}
											/>
										</div>
										<div className="field">
											<label htmlFor="srv-weight">Weight</label>
											<input className="input" id="srv-weight" name="weight" type="number" min="0" max="65535" value={form.weight} onChange={event => updateForm("weight", event.target.value)} />
										</div>
										<div className="field">
											<label htmlFor="srv-port">Port</label>
											<input className="input" id="srv-port" name="port" type="number" min="0" max="65535" value={form.port} onChange={event => updateForm("port", event.target.value)} />
										</div>
										<div className="field">
											<label htmlFor="srv-target">Target FQDN</label>
											<input
												autoComplete="off"
												className="input"
												id="srv-target"
												name="target"
												required
												spellCheck={false}
												value={form.target}
												onChange={event => updateForm("target", event.target.value)}
											/>
										</div>
									</>
								) : null}
								{form.type === "CAA" ? (
									<>
										<div className="field">
											<label htmlFor="caa-flags">Flags</label>
											<input className="input" id="caa-flags" name="flags" type="number" min="0" max="255" value={form.flags} onChange={event => updateForm("flags", event.target.value)} />
										</div>
										<div className="field">
											<label htmlFor="caa-tag">Tag</label>
											<select className="select" id="caa-tag" name="tag" value={form.tag} onChange={event => updateForm("tag", event.target.value as FormState["tag"])}>
												<option>issue</option>
												<option>issuewild</option>
												<option>iodef</option>
											</select>
										</div>
										<div className="field">
											<label htmlFor="caa-value">Value</label>
											<input
												autoComplete="off"
												className="input"
												id="caa-value"
												name="value"
												required
												spellCheck={false}
												value={form.value}
												onChange={event => updateForm("value", event.target.value)}
												placeholder="letsencrypt.org…"
											/>
										</div>
									</>
								) : null}
								<div className="field">
									<label htmlFor="record-ttl">TTL</label>
									<select className="select" id="record-ttl" name="ttl" value={form.ttl} disabled={form.proxied} onChange={event => updateForm("ttl", event.target.value)}>
										<option value="1">Auto</option>
										<option value="60">1 minute</option>
										<option value="300">5 minutes</option>
										<option value="3600">1 hour</option>
										<option value="86400">1 day</option>
									</select>
								</div>
							</div>
							{["A", "AAAA", "CNAME"].includes(form.type) ? (
								<label className={styles.proxyToggle}>
									<input
										name="proxied"
										type="checkbox"
										checked={form.proxied}
										onChange={event => {
											updateForm("proxied", event.target.checked);
											if (event.target.checked) updateForm("ttl", "1");
										}}
									/>
									<span>{form.proxied ? <Cloud aria-hidden="true" /> : <CloudOff aria-hidden="true" />}</span>
									<div>
										<b>Cloudflare Proxy</b>
										<small>{form.proxied ? "流量將經過 Cloudflare edge" : "DNS only，直接解析到 target"}</small>
									</div>
								</label>
							) : (
								<p className={styles.dnsOnly}>
									<CloudOff aria-hidden="true" /> {form.type} 不支援 Proxy，後端會強制 DNS only。
								</p>
							)}
							{deepProxy ? (
								<div className={styles.tlsWarning} role="alert">
									<ShieldAlert aria-hidden="true" />
									<p>
										<b>多層子網域 TLS 警告</b>Cloudflare Universal SSL 在一般 full setup 下通常只涵蓋根網域與第一層子網域。若未啟用 Total TLS、Advanced Certificate 或其他對應憑證，開啟 Proxy 可能造成
										HTTPS 憑證錯誤。{props.allowProxiedDeepSubdomains ? " 系統管理員已允許操作，但仍請確認憑證。" : " 請改用 DNS only，或聯絡管理員確認憑證設定。"}
									</p>
								</div>
							) : null}
							<footer>
								<button className="button" onClick={closeModal} type="button">
									取消
								</button>
								<button className="button buttonPrimary" disabled={busy || (!props.allowProxiedDeepSubdomains && deepProxy)} type="submit">
									{busy ? (
										"儲存中…"
									) : (
										<>
											<Check aria-hidden="true" />
											{editing ? "儲存變更" : "建立 record"}
										</>
									)}
								</button>
							</footer>
						</form>
					</section>
				</div>
			) : null}
		</section>
	);
}
