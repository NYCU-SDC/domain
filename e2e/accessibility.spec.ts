import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const publicRoutes = ["/", "/apply", "/docs", "/security", "/login"] as const;
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
			await page.waitForLoadState("networkidle");
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
