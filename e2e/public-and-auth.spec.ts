import { expect, test } from "@playwright/test";

test.describe("public SSR and login entry", () => {
  test("landing page exposes the complete platform and security story", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/給陽明交大社團的子網域管理平台/u);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("子網域管理平台");
    await expect(page.getByText("magic.nycu.club", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("evilmagic.nycu.club", { exact: false }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "只開放能被完整驗證的 DNS 類型" })).toBeVisible();
    for (const type of ["A", "AAAA", "CNAME", "TXT", "MX", "SRV", "CAA"]) {
      await expect(page.getByLabel("支援的 DNS 類型").getByText(type, { exact: true })).toBeVisible();
    }
    await expect(page.getByText("誰可以使用？")).toBeVisible();
    await expect(page.getByRole("link", { name: "隱私與安全說明" })).toHaveAttribute("href", "/security");
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
    const body = await response.json() as {
      error: { code: string; message: string };
      ok: boolean;
      requestId: string;
    };
    expect(body).toMatchObject({
      error: { code: "UNAUTHENTICATED" },
      ok: false,
    });
    expect(body.requestId).toBeTruthy();
  });
});
