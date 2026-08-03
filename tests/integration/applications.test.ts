import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

import {
	createAccessApplication,
	listAccessApplications,
	markApplicationNotification,
	normalizeAccessApplicationInput,
	reviewAccessApplication
} from "../../app/features/applications/server/applications.server";
import { notifyDiscordOfApplication } from "../../app/features/applications/server/discord.server";
import { readUrlEncodedForm } from "../../app/server/security/request.server";
import { insertTestUser, sessionFor, testRequest } from "../helpers";

const validRaw = {
	applicantName: "王小明",
	contact: "magic-club@example.edu.tw",
	currentWebsiteUrl: "https://magic.example.com/",
	githubLogin: "@Magician123",
	organizationName: "魔術社",
	purpose: "提供社團介紹、活動報名與歷屆成果展示，並由本屆幹部負責網站與 DNS 維護。",
	requestedNamespace: "MAGIC.nycu.club.",
	terms: "accepted",
	website: ""
};

describe("public namespace applications", () => {
	it("normalizes a valid application and rejects protected or suspicious input", () => {
		const normalized = normalizeAccessApplicationInput(validRaw, env);
		expect(normalized).toMatchObject({
			githubLogin: "magician123",
			requestedNamespace: "magic.nycu.club"
		});
		expect(() => normalizeAccessApplicationInput({ ...validRaw, requestedNamespace: "nycu.club" }, env)).toThrow(/真正子網域/u);
		expect(() => normalizeAccessApplicationInput({ ...validRaw, requestedNamespace: "www.nycu.club" }, env)).toThrow(/受平台保護/u);
		expect(() => normalizeAccessApplicationInput({ ...validRaw, currentWebsiteUrl: "https://user:pass@example.com/" }, env)).toThrow(/輸入資料格式/u);
		expect(() => normalizeAccessApplicationInput({ ...validRaw, website: "bot-filled" }, env)).toThrow(/輸入資料格式/u);
	});

	it("stores the application with an audit event and tracks notification delivery", async () => {
		const input = normalizeAccessApplicationInput(validRaw, env);
		const request = testRequest("/apply", { method: "POST" });
		const application = await createAccessApplication(env.DB, input, request, env, "req-application-create");
		expect(application).toMatchObject({
			githubLogin: "magician123",
			notificationStatus: "pending",
			requestedNamespace: "magic.nycu.club",
			status: "pending"
		});
		const stored = await env.DB.prepare("SELECT contact, notification_status AS notificationStatus FROM access_applications WHERE id = ?")
			.bind(application.id)
			.first<{ contact: string; notificationStatus: string }>();
		expect(stored).toEqual({
			contact: "magic-club@example.edu.tw",
			notificationStatus: "pending"
		});
		const audit = await env.DB.prepare("SELECT action, target_id AS targetId, status FROM audit_logs WHERE request_id = ?")
			.bind("req-application-create")
			.first<{ action: string; status: string; targetId: string }>();
		expect(audit).toEqual({
			action: "application.submit",
			status: "success",
			targetId: application.id
		});

		await markApplicationNotification(env.DB, application.id, "failed", "upstream unavailable");
		const delivery = await env.DB.prepare("SELECT notification_status AS status, notification_error AS error FROM access_applications WHERE id = ?")
			.bind(application.id)
			.first<{ error: string | null; status: string }>();
		expect(delivery).toEqual({ error: "upstream unavailable", status: "failed" });
	});

	it("sends a bounded Discord embed without allowing mentions", async () => {
		const application = await createAccessApplication(env.DB, normalizeAccessApplicationInput(validRaw, env), testRequest("/apply", { method: "POST" }), env, "req-webhook");
		const fetcher = vi.fn<typeof fetch>(async (input, init) => {
			expect(String(input)).toMatch(/^https:\/\/discord\.com\/api\/webhooks\//u);
			const body = JSON.parse(String(init?.body)) as {
				allowed_mentions: { parse: string[] };
				embeds: Array<{ fields: Array<{ value: string }>; title: string }>;
			};
			expect(body.allowed_mentions.parse).toEqual([]);
			expect(body.embeds[0]?.title).toBe("新的 nycu.club 子網域申請");
			expect(body.embeds[0]?.fields.some(field => field.value === "magic.nycu.club")).toBe(true);
			return new Response(null, { status: 204 });
		});
		await expect(notifyDiscordOfApplication(application, env, "req-webhook", fetcher)).resolves.toBeUndefined();
		expect(fetcher).toHaveBeenCalledOnce();
	});

	it("lets an admin review applications and writes before/after audit data", async () => {
		const adminId = await insertTestUser({ isAdmin: true, login: "reviewer" });
		const application = await createAccessApplication(env.DB, normalizeAccessApplicationInput(validRaw, env), testRequest("/apply", { method: "POST" }), env, "req-before-review");
		const reviewed = await reviewAccessApplication(
			{
				adminNote: "身分確認完成，等待 grant 建立。",
				applicationId: application.id,
				csrfToken: "x".repeat(64),
				status: "approved"
			},
			env.DB,
			testRequest("/admin/applications", { method: "POST" }),
			env,
			sessionFor(adminId, { isAdmin: true }),
			"req-review"
		);
		expect(reviewed).toMatchObject({
			adminNote: "身分確認完成，等待 grant 建立。",
			reviewedByLogin: "test-user",
			status: "approved"
		});
		const listed = await listAccessApplications(env.DB, {
			page: 1,
			search: "MAGIC",
			status: "approved"
		});
		expect(listed.total).toBe(1);
		expect(listed.items[0]).toMatchObject({ id: application.id, status: "approved" });
		const audit = await env.DB.prepare("SELECT action, before_json AS beforeJson, after_json AS afterJson FROM audit_logs WHERE request_id = ?")
			.bind("req-review")
			.first<{ action: string; afterJson: string; beforeJson: string }>();
		expect(audit?.action).toBe("application.review");
		expect(audit?.beforeJson).toContain('"status":"pending"');
		expect(audit?.afterJson).toContain('"status":"approved"');
	});
});

describe("bounded form parsing", () => {
	it("accepts urlencoded forms and rejects duplicate fields", async () => {
		const request = testRequest("/apply", {
			body: new URLSearchParams({ name: "value" }),
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			method: "POST"
		});
		await expect(readUrlEncodedForm(request)).resolves.toEqual({ name: "value" });

		const duplicate = testRequest("/apply", {
			body: "name=one&name=two",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			method: "POST"
		});
		await expect(readUrlEncodedForm(duplicate)).rejects.toThrow(/不可重複/u);
	});
});
