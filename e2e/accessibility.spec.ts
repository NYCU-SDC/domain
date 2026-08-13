import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const publicRoutes = ["/", "/apply", "/docs", "/security", "/login", "/sitemap"] as const;
const wcagTags = ["wcag2a", "wcag2aa", "wcag2aaa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectNoAutomatedWcagViolations(page: Page): Promise<void> {
	const results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
	const summary = results.violations
		.map(violation => `${violation.id}: ${violation.help}\n${violation.nodes.map(node => `  ${node.target.join(" ")}: ${node.failureSummary ?? ""}`).join("\n")}`)
		.join("\n\n");
	expect(results.violations, summary).toEqual([]);
}

test.describe("WCAG 2.2 accessibility guardrails", () => {
	test.describe.configure({ mode: "serial" });

	for (const path of publicRoutes) {
		test(`${path} has no automated A, AA, or AAA violations`, async ({ page }) => {
			await page.goto(path);
			await expectNoAutomatedWcagViolations(page);
		});
	}

	test("skip link reaches the page's main content", async ({ page }) => {
		await page.goto("/");
		await page.keyboard.press("Tab");
		const skipLink = page.getByRole("link", { name: "跳到主要內容" });
		await expect(skipLink).toBeFocused();
		await skipLink.press("Enter");
		await expect(page.locator("#main-content")).toBeFocused();
	});

	test("SPA page changes restart focus and announce the loaded page", async ({ page }) => {
		await page.goto("/");
		const routeStatus = page.locator("#route-status");
		await expect(routeStatus).toHaveAttribute("role", "status");
		await expect(routeStatus).toHaveAttribute("aria-live", "polite");

		const docsLink = page.getByRole("navigation", { name: "頁尾導覽" }).getByRole("link", { name: "使用說明" });
		await docsLink.focus();
		await expect(docsLink).toBeFocused();
		await docsLink.press("Enter");

		await expect(page).toHaveURL(/\/docs$/u);
		await expect(page.locator("#main-content")).toBeFocused();
		await expect(routeStatus).toHaveText("頁面已載入：安全管理社團 DNS 與 cache");

		await page.keyboard.press("Tab");
		await expect(page.getByRole("navigation", { name: "麵包屑" }).getByRole("link", { name: "首頁" })).toBeFocused();
	});

	test("public subpages identify their location with linked breadcrumbs", async ({ page }) => {
		const routes = [
			["/apply", "申請子網域"],
			["/docs", "使用說明"],
			["/security", "隱私與安全"],
			["/login", "登入"],
			["/sitemap", "網站導覽"]
		] as const;

		for (const [path, current] of routes) {
			await page.goto(path);
			const breadcrumbs = page.getByRole("navigation", { name: "麵包屑" });
			await expect(breadcrumbs.getByRole("link", { name: "首頁" })).toHaveAttribute("href", "/");
			const currentItem = breadcrumbs.locator('[aria-current="page"]');
			await expect(currentItem).toHaveText(current);
			await expect(currentItem).not.toHaveAttribute("href");
		}
	});

	test("site map documents semantic keyboard navigation and lists every public page", async ({ page }) => {
		await page.goto("/sitemap");
		await expect(page.getByRole("heading", { name: "鍵盤與網站導覽說明" })).toBeVisible();
		await expect(page.getByText(/第一個焦點按 Enter 啟用「跳到主要內容」/u)).toBeVisible();
		await expect(page.getByRole("navigation", { name: "主要導覽" })).toBeVisible();
		await expect(page.locator("main#main-content")).toBeVisible();
		await expect(page.getByRole("contentinfo")).toBeVisible();
		await expect(page.locator("[accesskey]")).toHaveCount(0);

		const pageList = page.getByRole("heading", { name: "公開頁面" }).locator("xpath=following-sibling::ul[1]");
		for (const destination of ["首頁", "申請子網域", "使用說明", "隱私與安全", "登入"]) {
			await expect(pageList.getByRole("link", { name: destination, exact: true })).toBeVisible();
		}
	});

	test("new-window links include a programmatic warning", async ({ page }) => {
		await page.goto("/");
		const maintainerLink = page.locator('#main-content a[href="https://sdc.nycu.club"]');
		await expect(maintainerLink).toHaveAttribute("target", "_blank");
		await expect(maintainerLink).toHaveAttribute("title", "sdc.nycu.club（另開新視窗）");
		await expect(maintainerLink).toHaveAccessibleName(/另開新視窗/u);

		const footerLink = page.locator('#site-footer a[href="https://sdc.nycu.club"]');
		await expect(footerLink).toHaveAttribute("target", "_blank");
		await expect(footerLink).toHaveAttribute("title", "交大軟體開發社（另開新視窗）");
		await expect(footerLink).toHaveAccessibleName(/另開新視窗/u);
	});

	test("FAQ questions expose a visible keyboard focus state", async ({ page }) => {
		await page.goto("/#faq");
		await page.waitForLoadState("networkidle");
		const question = page.getByRole("button", { name: "誰可以使用？" });
		await expect(question).toBeEnabled();
		await question.focus();
		await expect(question).toBeFocused();
		await expect(question).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
		expect(await question.evaluate(element => getComputedStyle(element).boxShadow)).not.toBe("none");
		await question.press("Enter");
		await expect(question).toHaveAttribute("aria-expanded", "true");
	});

	test("form controls and buttons meet the enhanced target size", async ({ page }) => {
		for (const path of publicRoutes) {
			await page.goto(path);
			const undersized = await page.locator('button:visible, input:not([type="checkbox"]):not([type="hidden"]):not([tabindex="-1"]):visible, select:visible, textarea:visible').evaluateAll(elements =>
				elements.flatMap(element => {
					const rect = element.getBoundingClientRect();
					return rect.width < 44 || rect.height < 44 ? [`${element.tagName.toLowerCase()}#${element.id || "(no-id)"} ${Math.round(rect.width)}x${Math.round(rect.height)}`] : [];
				})
			);
			expect(undersized, `${path} contains targets smaller than 44 by 44 CSS pixels`).toEqual([]);
		}
	});

	test("application errors and confirmation remain accessible dynamic states", async ({ page }) => {
		await page.goto("/apply");
		await page.getByRole("button", { name: "檢查申請資料" }).click();
		await expect(page.getByRole("alert")).toContainText("請修正以下欄位");
		await expect(page.getByLabel("社團／單位名稱")).toBeFocused();
		await expectNoAutomatedWcagViolations(page);

		await page.getByLabel("社團／單位名稱").fill("可及性測試社");
		await page.getByLabel("申請人姓名").fill("測試申請人");
		await page.getByLabel("GitHub username").fill("accessible-club");
		await page.getByLabel("聯絡方式").fill("accessible@example.edu.tw");
		await page.getByLabel("想申請的網域").fill(`accessible-${Date.now()}`);
		await page.getByLabel("網站用途").fill("這是一份用來驗證申請確認畫面鍵盤操作、語意結構與狀態訊息的可及性測試資料。");
		await page.getByLabel(/我了解子網域僅供社團使用/u).check();
		await page.getByRole("button", { name: "檢查申請資料" }).click();
		await expect(page.getByRole("heading", { name: "確認申請資料" })).toBeFocused();
		await expectNoAutomatedWcagViolations(page);
	});
});
