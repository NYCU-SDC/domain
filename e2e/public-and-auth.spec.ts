import { expect, test } from "@playwright/test";

test.describe("public SSR and login entry", () => {
	test("landing page explains the focused platform scope", async ({ page }) => {
		const response = await page.goto("/");
		expect(response?.status()).toBe(200);
		await expect(page).toHaveTitle(/陽明交大社團子網域管理/u);
		await expect(page.getByRole("heading", { level: 1 })).toContainText("社團網站");
		await expect(page.getByText("magic.nycu.club", { exact: true }).first()).toBeVisible();
		await expect(page.getByText("evilmagic.nycu.club", { exact: false }).first()).toBeVisible();
		await expect(page.getByRole("heading", { name: "可以改什麼" })).toBeVisible();
		for (const type of ["A", "AAAA", "CNAME", "TXT", "MX", "SRV", "CAA"]) {
			await expect(page.getByLabel("支援的 DNS 類型").getByText(type, { exact: true })).toBeVisible();
		}
		await expect(page.getByText("誰可以使用？")).toBeVisible();
		await expect(page.getByRole("link", { name: "隱私與安全" })).toHaveAttribute("href", "/security");
		await expect(page.getByRole("link", { name: "交大軟體開發社" }).first()).toHaveAttribute("href", "https://sdc.nycu.club");
	});

	test("application form validates and confirms a stored request", async ({ page }) => {
		await page.goto("/apply");
		await expect(page.getByRole("heading", { name: "申請資料" })).toBeVisible();
		await page.getByLabel("社團／單位名稱").fill("魔術社");
		await page.getByLabel("申請人姓名").fill("王小明");
		await page.getByLabel("GitHub username").fill("magician123");
		await page.getByLabel("聯絡方式").fill("magic@example.edu.tw");
		await page.getByLabel("想申請的 namespace").fill("magic.nycu.club");
		await page.getByLabel("網站用途").fill("提供社團介紹、活動報名與成果展示，並由本屆幹部持續負責網站及 DNS 維護。");
		await page.getByText("我了解 namespace 只限申請用途").click();
		await page.getByRole("button", { name: "送出申請" }).click();
		await expect(page.getByRole("heading", { name: "申請已送出" })).toBeVisible();
		await expect(page.getByText(/申請編號/u)).toBeVisible();
	});

	test("login requests only minimum GitHub identity", async ({ page }) => {
		await page.goto("/login");
		await expect(page.getByRole("heading", { name: "使用 GitHub 帳號登入" })).toBeVisible();
		await expect(page.getByText("不要求 repository 權限")).toBeVisible();
		await expect(page.getByText("不要求 organization 管理權")).toBeVisible();
		await expect(page.getByRole("link", { name: /使用 GitHub 繼續/u })).toHaveAttribute("href", "/auth/github");
	});

	test("public support routes return useful SSR content", async ({ page }) => {
		await page.goto("/security");
		await expect(page.getByRole("heading", { name: /權限、憑證與操作紀錄/u })).toBeVisible();
		await page.goto("/status");
		await expect(page.getByRole("heading", { name: "服務狀態入口" })).toBeVisible();
	});
});

test.describe("unauthenticated authorization boundaries", () => {
	test("dashboard and admin routes redirect to login", async ({ page }) => {
		await page.goto("/dashboard");
		await expect(page).toHaveURL(/\/login\?returnTo=%2Fdashboard$/u);
		await page.goto("/admin/users");
		await expect(page).toHaveURL(/\/login\?returnTo=%2Fadmin%2Fusers$/u);
	});

	test("pending page does not reveal protected data without a valid session", async ({ page }) => {
		await page.goto("/access-pending");
		await expect(page).toHaveURL(/\/login$/u);
		await expect(page.getByText("DNS records")).toHaveCount(0);
	});

	test("versioned API returns a no-store structured authentication error", async ({ request }) => {
		const response = await request.get("/api/v1/me");
		expect(response.status()).toBe(401);
		expect(response.headers()["cache-control"]).toBe("no-store");
		const body = (await response.json()) as {
			error: { code: string; message: string };
			ok: boolean;
			requestId: string;
		};
		expect(body).toMatchObject({
			error: { code: "UNAUTHENTICATED" },
			ok: false
		});
		expect(body.requestId).toBeTruthy();
	});
});
