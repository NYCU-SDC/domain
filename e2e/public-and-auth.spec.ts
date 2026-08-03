import { expect, test } from "@playwright/test";

test.describe("public SSR and login entry", () => {
	test("landing page explains the focused platform scope", async ({ page }) => {
		const response = await page.goto("/");
		expect(response?.status()).toBe(200);
		await expect(page).toHaveTitle(/免費陽明交大社團子網域/u);
		await expect(page.getByRole("heading", { level: 1 })).toContainText("免費交大");
		const namespaceCard = page.getByLabel("Namespace 權限範圍示例");
		const namespaceBars = namespaceCard.getByRole("list");
		for (const hostname of ["magic.nycu.club", "www.magic.nycu.club", "*.magic.nycu.club"]) {
			await expect(namespaceBars.getByText(hostname, { exact: true })).toBeVisible();
		}
		await expect(namespaceCard).not.toContainText("evilmagic.nycu.club");
		await expect(page.getByRole("heading", { name: "可以改什麼" })).toBeVisible();
		for (const type of ["A", "AAAA", "CNAME", "TXT", "MX", "SRV", "CAA"]) {
			await expect(page.getByLabel("支援的 DNS 類型").getByText(type, { exact: true })).toBeVisible();
		}
		const firstFaq = page.getByRole("button", { name: "誰可以使用？" });
		await expect(firstFaq).toBeEnabled({ timeout: 30_000 });
		await expect(firstFaq).toHaveAttribute("aria-expanded", "false");
		await firstFaq.click();
		await expect(firstFaq).toHaveAttribute("aria-expanded", "true");
		await expect(page.getByText("陽明交大社團或校內單位的網站維護者都可以提出申請。", { exact: false })).toBeVisible();
		await firstFaq.click();
		await expect(firstFaq).toHaveAttribute("aria-expanded", "false");
		await expect(page.getByRole("link", { name: "隱私與安全" })).toHaveAttribute("href", "/security");
		await expect(page.getByRole("link", { name: "交大軟體開發社" }).first()).toHaveAttribute("href", "https://sdc.nycu.club");
	});

	test("application form validates and confirms a stored request", async ({ page }) => {
		await page.goto("/apply");
		await expect(page.getByRole("heading", { name: "申請資料" })).toBeVisible();
		await expect(page.getByText(".nycu.club", { exact: true })).toBeVisible();
		await page.getByRole("button", { name: "送出申請" }).click();
		await expect(page.getByLabel("社團／單位名稱")).toBeFocused();
		expect(await page.getByLabel("社團／單位名稱").evaluate(input => (input as HTMLInputElement).validity.valueMissing)).toBe(true);
		await page.getByLabel("社團／單位名稱").fill("魔術社");
		await page.getByLabel("申請人姓名").fill("王小明");
		await page.getByLabel("GitHub username").fill("magician123");
		await page.getByLabel("聯絡方式").fill("magic@example.edu.tw");
		await page.getByLabel("想申請的網域").fill("magic");
		await page.getByLabel("網站用途").fill("提供社團介紹、活動報名與成果展示，並由本屆幹部持續負責網站及 DNS 維護。");
		await page.getByText("我了解子網域僅供社團使用").click();
		await page.getByRole("button", { name: "送出申請" }).click();
		await expect(page.getByRole("heading", { name: "申請已送出" })).toBeVisible();
		await expect(page.getByText(/申請編號/u)).toBeVisible();
	});

	test("login offers GitHub entry and the application path", async ({ page }) => {
		await page.goto("/login");
		const main = page.getByRole("main");
		await expect(main.getByRole("heading", { name: "登入", exact: true })).toBeVisible();
		await expect(main.getByRole("link", { name: "GitHub 登入" })).toHaveAttribute("href", "/auth/github");
		await expect(main.getByRole("link", { name: "填寫申請表單" })).toHaveAttribute("href", "/apply");
	});

	test("public support routes return useful SSR content", async ({ page }) => {
		await page.goto("/security");
		await expect(page.getByRole("heading", { name: "隱私與安全", exact: true })).toBeVisible();
		await expect(page.getByRole("navigation", { name: "主要導覽" }).getByRole("link", { name: "申請子網域" })).toHaveAttribute("href", "/apply");
		await expect(page.getByRole("navigation", { name: "頁尾導覽" }).getByRole("link", { name: "隱私與安全" })).toHaveAttribute("href", "/security");
	});

	test("removed status route returns a noindex 404", async ({ page }) => {
		const response = await page.goto("/status");
		expect(response?.status()).toBe(404);
		await expect(page).toHaveTitle(/404 找不到這個頁面/u);
		await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow, noarchive, nosnippet");
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
