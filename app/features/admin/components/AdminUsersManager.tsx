import { BadgeCheck, Ban, GitFork, KeyRound, Pencil, Plus, Search, Shield, UserCheck, X } from "lucide-react";
import { useMemo, useState, type SyntheticEvent } from "react";

import { apiRequest } from "~/shared/client/api";
import { EmptyState } from "~/shared/components/feedback/EmptyState";
import { useToast } from "~/shared/components/feedback/ToastProvider";
import { DataTableFrame } from "~/shared/components/table/DataTableFrame";
import styles from "./AdminUsersManager.module.css";

interface AdminUser {
	readonly createdAt: number;
	readonly githubAvatarUrl: string;
	readonly githubId: string;
	readonly githubLogin: string;
	readonly githubName: string | null;
	readonly githubProfileUrl: string;
	readonly grants: string[];
	readonly id: string;
	readonly isAdmin: boolean;
	readonly isBootstrapAdmin: boolean;
	readonly lastLoginAt: number | null;
	readonly note: string | null;
	readonly status: "active" | "pending" | "suspended";
}

interface GithubPreview {
	readonly avatarUrl: string;
	readonly id: string;
	readonly login: string;
	readonly name: string | null;
	readonly profileUrl: string;
}

interface FormState {
	grants: string;
	isAdmin: boolean;
	note: string;
	status: "active" | "pending" | "suspended";
	username: string;
}

const initialForm: FormState = {
	grants: "",
	isAdmin: false,
	note: "",
	status: "pending",
	username: ""
};

const formatTime = (timestamp: number | null) => (timestamp ? new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" }).format(timestamp) : "從未登入");

function parseGrants(value: string): string[] {
	return [
		...new Set(
			value
				.split(/[\n,]/u)
				.map(grant => grant.trim())
				.filter(Boolean)
		)
	];
}

export function AdminUsersManager({ csrfToken, users }: { readonly csrfToken: string; readonly users: AdminUser[] }) {
	const { showToast } = useToast();
	const [search, setSearch] = useState("");
	const [status, setStatus] = useState("all");
	const [admin, setAdmin] = useState("all");
	const [modal, setModal] = useState<"create" | "edit" | null>(null);
	const [editing, setEditing] = useState<AdminUser | null>(null);
	const [form, setForm] = useState<FormState>(initialForm);
	const [preview, setPreview] = useState<GithubPreview | null>(null);
	const [busy, setBusy] = useState(false);

	const filtered = useMemo(
		() =>
			users.filter(user => {
				const haystack = `${user.githubLogin} ${user.githubId} ${user.githubName ?? ""} ${user.note ?? ""} ${user.grants.join(" ")}`.toLowerCase();
				return haystack.includes(search.toLowerCase()) && (status === "all" || user.status === status) && (admin === "all" || user.isAdmin === (admin === "yes"));
			}),
		[admin, search, status, users]
	);

	const openCreate = () => {
		setForm(initialForm);
		setPreview(null);
		setEditing(null);
		setModal("create");
	};
	const openEdit = (user: AdminUser) => {
		setEditing(user);
		setPreview(null);
		setForm({ grants: user.grants.join("\n"), isAdmin: user.isAdmin, note: user.note ?? "", status: user.status, username: user.githubLogin });
		setModal("edit");
	};
	const update = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm(current => ({ ...current, [key]: value }));

	const resolve = async () => {
		setBusy(true);
		try {
			const identity = await apiRequest<GithubPreview>("/api/v1/admin/github-users/resolve", csrfToken, { body: { username: form.username }, method: "POST" });
			setPreview(identity);
			showToast("已從 GitHub 取得 canonical identity", "success");
		} catch (error) {
			showToast(error instanceof Error ? error.message : "GitHub user resolve 失敗", "error");
		} finally {
			setBusy(false);
		}
	};

	const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (modal === "create" && !preview) {
			showToast("請先解析並確認 GitHub identity", "error");
			return;
		}
		setBusy(true);
		try {
			const body = { grants: parseGrants(form.grants), isAdmin: form.isAdmin, note: form.note.trim() || null, status: form.status, ...(modal === "create" ? { username: form.username } : {}) };
			await apiRequest(modal === "create" ? "/api/v1/admin/users" : `/api/v1/admin/users/${editing?.id ?? ""}`, csrfToken, { body, method: modal === "create" ? "POST" : "PATCH" });
			showToast(modal === "create" ? "使用者已建立" : "使用者與權限已更新，sessions 已撤銷", "success");
			setModal(null);
			window.location.reload();
		} catch (error) {
			showToast(error instanceof Error ? error.message : "儲存失敗", "error");
		} finally {
			setBusy(false);
		}
	};

	const revokeSessions = async (user: AdminUser) => {
		if (!window.confirm(`撤銷 @${user.githubLogin} 的所有 sessions？`)) return;
		try {
			const result = await apiRequest<{ revoked: number }>(`/api/v1/admin/users/${user.id}/revoke-sessions`, csrfToken, { body: {}, method: "POST" });
			showToast(`已撤銷 ${result.revoked} 個 sessions`, "success");
		} catch (error) {
			showToast(error instanceof Error ? error.message : "撤銷失敗", "error");
		}
	};

	return (
		<section>
			<div className={styles.toolbar}>
				<label>
					<Search aria-hidden="true" />
					<span className="srOnly">搜尋使用者</span>
					<input autoComplete="off" name="user-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Username、numeric ID、note 或 namespace…" />
				</label>
				<select aria-label="Status filter" name="user-status-filter" value={status} onChange={event => setStatus(event.target.value)}>
					<option value="all">全部 status</option>
					<option value="active">Active</option>
					<option value="pending">Pending</option>
					<option value="suspended">Suspended</option>
				</select>
				<select aria-label="Admin filter" name="user-admin-filter" value={admin} onChange={event => setAdmin(event.target.value)}>
					<option value="all">全部角色</option>
					<option value="yes">Admins</option>
					<option value="no">Members</option>
				</select>
				<button className="button buttonPrimary" onClick={openCreate} type="button">
					<Plus aria-hidden="true" />
					新增 GitHub 使用者
				</button>
			</div>
			{filtered.length ? (
				<DataTableFrame className={styles.table}>
					<table>
						<thead>
							<tr>
								<th>User</th>
								<th>GitHub numeric ID</th>
								<th>Status</th>
								<th>Role</th>
								<th>Namespaces</th>
								<th>Internal note</th>
								<th>Last login</th>
								<th />
							</tr>
						</thead>
						<tbody>
							{filtered.map(user => (
								<tr key={user.id}>
									<td>
										<a href={user.githubProfileUrl}>
											<img src={user.githubAvatarUrl} width="34" height="34" alt="" />
											<span>
												<b>@{user.githubLogin}</b>
												<small>{user.githubName ?? "—"}</small>
											</span>
										</a>
									</td>
									<td>
										<code>{user.githubId}</code>
									</td>
									<td>
										<span className="statusPill" data-tone={user.status === "active" ? "success" : user.status === "suspended" ? "danger" : "warning"}>
											{user.status}
										</span>
									</td>
									<td>
										{user.isAdmin ? (
											<span className="statusPill" data-tone="success">
												<Shield aria-hidden="true" />
												Admin{user.isBootstrapAdmin ? " / Bootstrap" : ""}
											</span>
										) : (
											"Member"
										)}
									</td>
									<td>
										<span className={styles.grantCount}>{user.grants.length}</span>
										<div className={styles.grantTooltip}>{user.grants.join(", ") || "No grants"}</div>
									</td>
									<td>
										<span className={styles.note}>{user.note ?? "—"}</span>
									</td>
									<td>{formatTime(user.lastLoginAt)}</td>
									<td>
										<div className={styles.actions}>
											<button aria-label={`編輯 @${user.githubLogin}`} onClick={() => openEdit(user)} title="編輯" type="button">
												<Pencil aria-hidden="true" />
											</button>
											<button aria-label={`撤銷 @${user.githubLogin} sessions`} onClick={() => revokeSessions(user)} title="撤銷 sessions" type="button">
												<KeyRound aria-hidden="true" />
											</button>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</DataTableFrame>
			) : (
				<EmptyState title="找不到使用者" description="請調整搜尋、status 或 admin filter。" />
			)}
			{modal ? (
				<div className={styles.backdrop}>
					<section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="admin-user-form-title">
						<header>
							<h2 id="admin-user-form-title">{modal === "create" ? "新增 GitHub 使用者" : `編輯 @${editing?.githubLogin ?? ""}`}</h2>
							<button aria-label="關閉" onClick={() => setModal(null)} type="button">
								<X aria-hidden="true" />
							</button>
						</header>
						<form onSubmit={submit}>
							{modal === "create" ? (
								<div className={styles.resolveRow}>
									<label className="field">
										<span className="fieldLabel">GitHub username</span>
										<input
											autoComplete="off"
											className="input"
											name="github-username"
											required
											spellCheck={false}
											value={form.username}
											onChange={event => {
												update("username", event.target.value);
												setPreview(null);
											}}
										/>
									</label>
									<button className="button" disabled={busy || !form.username} onClick={resolve} type="button">
										<GitFork aria-hidden="true" />
										解析身份
									</button>
								</div>
							) : null}
							{preview ? (
								<div className={styles.preview}>
									<img src={preview.avatarUrl} width="56" height="56" alt="" />
									<div>
										<b>{preview.name ?? preview.login}</b>
										<span>@{preview.login}</span>
										<code>GitHub ID: {preview.id}</code>
									</div>
									<BadgeCheck />
								</div>
							) : null}
							<div className={styles.formGrid}>
								<label className="field">
									<span className="fieldLabel">Status</span>
									<select className="select" name="status" value={form.status} onChange={event => update("status", event.target.value as FormState["status"])} disabled={form.isAdmin}>
										<option value="pending">Pending</option>
										<option value="active">Active</option>
										<option value="suspended">Suspended</option>
									</select>
								</label>
								<label className={styles.check}>
									<input
										name="is-admin"
										type="checkbox"
										checked={form.isAdmin}
										disabled={editing?.isBootstrapAdmin}
										onChange={event => {
											update("isAdmin", event.target.checked);
											if (event.target.checked) update("status", "active");
										}}
									/>
									<Shield aria-hidden="true" />
									<span>
										<b>Administrator</b>
										<small>可管理所有非 protected records 與使用者</small>
									</span>
								</label>
								<label className="field">
									<span className="fieldLabel">Internal note</span>
									<textarea
										autoComplete="off"
										className="textarea"
										maxLength={500}
										name="note"
										value={form.note}
										onChange={event => update("note", event.target.value)}
										placeholder="例如：魔術社 2026 年度社長…"
									/>
									<small className="helpText">只對 admin 顯示，不會出現在一般 user API。</small>
								</label>
								<label className="field">
									<span className="fieldLabel">Namespace grants</span>
									<textarea
										autoComplete="off"
										className="textarea"
										name="namespace-grants"
										spellCheck={false}
										value={form.grants}
										onChange={event => update("grants", event.target.value)}
										placeholder="magic.nycu.club\nphoto.nycu.club"
									/>
									<small className="helpText">每行或逗號分隔。每個 grant 都包含 namespace 下所有子網域；重疊範圍會正規化。</small>
								</label>
							</div>
							{editing?.isBootstrapAdmin ? (
								<div className={styles.protected}>
									<UserCheck />
									Bootstrap admin 的 admin 權限不可透過 UI 移除。
								</div>
							) : null}
							{modal === "edit" ? (
								<div className={styles.sessionWarning}>
									<Ban />
									任何 status、admin、note 或 grant 變更都會撤銷此使用者所有 sessions。
								</div>
							) : null}
							<footer>
								<button className="button" onClick={() => setModal(null)} type="button">
									取消
								</button>
								<button className="button buttonPrimary" disabled={busy || (modal === "create" && !preview)} type="submit">
									{busy ? "儲存中…" : "儲存使用者"}
								</button>
							</footer>
						</form>
					</section>
				</div>
			) : null}
		</section>
	);
}
