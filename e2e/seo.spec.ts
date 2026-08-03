import { expect, test } from "@playwright/test";

test.describe("search metadata", () => {
	test("publishes route-specific canonical and social metadata", async ({ page }) => {
		await page.goto("/apply");
		await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://nycu.club/apply");
		await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /申請免費的 nycu\.club/u);
		await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", "https://nycu.club/apply");
		await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "https://nycu.club/og-image.png");
		await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
	});

	test("publishes homepage structured data", async ({ page }) => {
		await page.goto("/");
		const structuredData = JSON.parse(await page.locator('script[type="application/ld+json"]').innerText()) as {
			"@context": string;
			"@graph": Array<{ "@type": string }>;
		};
		expect(structuredData["@context"]).toBe("https://schema.org");
		expect(structuredData["@graph"].map(item => item["@type"])).toEqual(["Organization", "WebSite", "WebApplication"]);
	});

	test("keeps authentication pages out of search results", async ({ page }) => {
		await page.goto("/login");
		await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow, noarchive, nosnippet");
		await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
	});

	test("serves crawl directives, sitemap, and the social image", async ({ request }) => {
		const robots = await request.get("/robots.txt");
		expect(robots.status()).toBe(200);
		const robotsBody = await robots.text();
		expect(robotsBody).toContain("Disallow: /dashboard");
		expect(robotsBody).toContain("Sitemap: https://nycu.club/sitemap.xml");

		const sitemap = await request.get("/sitemap.xml");
		expect(sitemap.status()).toBe(200);
		expect(sitemap.headers()["content-type"]).toContain("application/xml");
		const sitemapBody = await sitemap.text();
		expect(sitemapBody).toContain("/apply</loc>");
		expect(sitemapBody).not.toContain("/dashboard");
		expect(sitemapBody).not.toContain("/login");

		const socialImage = await request.get("/og-image.png");
		expect(socialImage.status()).toBe(200);
		expect(socialImage.headers()["content-type"]).toBe("image/png");
	});
});
