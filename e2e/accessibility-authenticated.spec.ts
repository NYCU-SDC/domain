import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const storagePath = process.env.E2E_AUTH_STORAGE;
const authenticatedRoutes = ["/dashboard", "/dashboard/dns", "/dashboard/cache", "/dashboard/audit", "/dashboard/account", "/admin", "/admin/applications", "/admin/users"] as const;
const wcagTags = ["wcag2a", "wcag2aa", "wcag2aaa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectNoAutomatedWcagViolations(page: Page): Promise<void> {
	const results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
	const summary = results.violations
		.map(violation => `${violation.id}: ${violation.help}\n${violation.nodes.map(node => `  ${node.target.join(" ")}: ${node.failureSummary ?? ""}`).join("\n")}`)
		.join("\n\n");
	expect(results.violations, summary).toEqual([]);
}

test.describe("authenticated WCAG guardrails", () => {
	test.skip(!storagePath, "Set E2E_AUTH_STORAGE to an authenticated Playwright storage-state file.");
	test.use({ storageState: storagePath ?? { cookies: [], origins: [] } });
	test.describe.configure({ mode: "serial" });

	for (const path of authenticatedRoutes) {
		test(`${path} has no automated A, AA, or AAA violations`, async ({ page }) => {
			await page.goto(path);
			await page.waitForLoadState("networkidle");
			await expectNoAutomatedWcagViolations(page);
		});
	}

	test("authenticated controls meet the enhanced target size", async ({ page }) => {
		for (const path of authenticatedRoutes) {
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

	test("cache purge tabs support arrow-key navigation", async ({ page }) => {
		await page.goto("/dashboard/cache");
		const urlsTab = page.getByRole("tab", { name: /Purge URLs/u });
		const hostnamesTab = page.getByRole("tab", { name: "Hostnames" });
		await urlsTab.focus();
		await page.keyboard.press("ArrowRight");
		await expect(hostnamesTab).toBeFocused();
		await expect(hostnamesTab).toHaveAttribute("aria-selected", "true");
		await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "cache-tab-hostnames");
	});

	test("user editor traps focus and restores it when closed", async ({ page }) => {
		await page.goto("/admin/users");
		const editButton = page.getByRole("button", { name: /^編輯 @/u }).first();
		await editButton.click();
		const dialog = page.getByRole("dialog", { name: /^編輯 @/u });
		await expect(dialog).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();
		await expect(editButton).toBeFocused();
	});

	test("mobile navigation announces and restores its disclosure state", async ({ page }) => {
		test.skip((page.viewportSize()?.width ?? 1_280) > 600, "Mobile viewport only.");
		await page.goto("/dashboard");
		const menuButton = page.getByRole("button", { name: "開啟選單" });
		await menuButton.click();
		await expect(menuButton).toHaveAttribute("aria-expanded", "true");
		await expect(page.getByRole("button", { name: "關閉選單" }).first()).toBeFocused();
		await page.keyboard.press("Escape");
		await expect(menuButton).toHaveAttribute("aria-expanded", "false");
		await expect(menuButton).toBeFocused();
	});
});
