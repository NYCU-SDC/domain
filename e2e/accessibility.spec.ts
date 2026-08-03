import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const publicRoutes = ["/", "/apply", "/docs", "/security", "/status", "/login"] as const;
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
});
