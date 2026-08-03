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
		await expect(page.getByRole("link", { name: "GitHub", exact: true })).toHaveAttribute("href", "https://github.com/NYCU-SDC/domain");
		await expect(page.getByRole("link", { name: "毛哥EM", exact: true })).toHaveAttribute("href", "https://github.com/elvisdragonmao/");
		await expect(page.getByRole("link", { name: "交大軟體開發社" }).first()).toHaveAttribute("href", "https://sdc.nycu.club");
	});

	test("application form lists errors, reviews every value, and only then submits", async ({ page }) => {
		await page.goto("/apply");
		await expect(page.getByRole("heading", { name: "申請資料" })).toBeVisible();
		await expect(page.getByText(".nycu.club", { exact: true })).toBeVisible();
		for (const id of ["organizationName", "applicantName", "githubLogin", "contact", "requestedNamespace", "currentWebsiteUrl", "purpose", "terms"]) {
			await expect(page.locator(`label[for="${id}"]`)).toHaveCount(1);
		}

		await page.getByRole("button", { name: "檢查申請資料" }).click();
		const errorSummary = page.getByRole("alert");
		await expect(errorSummary.getByRole("heading", { name: "請修正以下欄位" })).toBeVisible();
		for (const message of [
			"請填寫社團或單位名稱",
			"請填寫申請人姓名",
			"請填寫 GitHub username",
			"請填寫可聯絡到你的 Email 或 Discord 帳號",
			"請填寫想申請的網域",
			"請說明網站用途與預計內容",
			"請確認你了解子網域與使用規範"
		]) {
			await expect(errorSummary.getByRole("link", { name: message })).toBeVisible();
		}
		await expect(page.getByLabel("社團／單位名稱")).toBeFocused();
		await page.getByLabel("社團／單位名稱").fill("魔術社");
		await page.getByLabel("申請人姓名").fill("王小明");
		await page.getByLabel("GitHub username").fill("magician123");
		await page.getByLabel("聯絡方式").fill("magic@example.edu.tw");
		await page.getByLabel("想申請的網域").fill("magic");
		await page.getByLabel("現有網站（選填）").fill("https://magic.example.edu.tw/");
		await page.getByLabel("網站用途").fill("提供社團介紹、活動報名與成果展示，並由本屆幹部持續負責網站及 DNS 維護。");
		await page.getByLabel(/我了解子網域僅供社團使用/u).check();
		await page.getByRole("button", { name: "檢查申請資料" }).click();

		const reviewTitle = page.getByRole("heading", { name: "確認申請資料" });
		await expect(reviewTitle).toBeFocused();
		const reviewList = page.locator("dl");
		for (const value of ["魔術社", "王小明", "@magician123", "magic@example.edu.tw", "magic.nycu.club", "https://magic.example.edu.tw/", "已確認"]) {
			await expect(reviewList.getByText(value, { exact: true })).toBeVisible();
		}
		await expect(reviewList).toContainText("提供社團介紹、活動報名與成果展示");
		await expect(page.getByRole("heading", { name: "申請已送出" })).toHaveCount(0);

		await page.getByRole("button", { name: "返回修改" }).click();
		await expect(page.getByRole("heading", { name: "申請資料" })).toBeFocused();
		await expect(page.getByLabel("社團／單位名稱")).toHaveValue("魔術社");
		await expect(page.getByLabel("想申請的網域")).toHaveValue("magic");
		await expect(page.getByLabel(/我了解子網域僅供社團使用/u)).toBeChecked();

		await page.getByRole("button", { name: "檢查申請資料" }).click();
		await expect(reviewTitle).toBeFocused();
		await page.getByRole("button", { name: "確認並送出申請" }).click();
		await expect(page.getByRole("heading", { name: "申請已送出" })).toBeVisible();
		await expect(page.getByRole("heading", { name: "申請已送出" })).toBeFocused();
		await expect(page.getByText(/申請編號/u)).toBeVisible();
	});

	test("application action is cancelled when the pointer is released outside", async ({ page }) => {
		await page.goto("/apply");
		const button = page.getByRole("button", { name: "檢查申請資料" });
		const box = await button.boundingBox();
		expect(box).not.toBeNull();
		if (!box) return;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(Math.max(0, box.x - 20), Math.max(0, box.y - 20));
		await page.mouse.up();
		await expect(page.getByRole("heading", { name: "申請資料" })).toBeVisible();
		await expect(page.getByRole("heading", { name: "確認申請資料" })).toHaveCount(0);
		await expect(page.getByRole("alert")).toHaveCount(0);
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
