import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	expect: { timeout: 5_000 },
	fullyParallel: true,
	reporter: process.env.CI ? [["html", { open: "never" }], ["github"]] : "list",
	retries: process.env.CI ? 2 : 0,
	testDir: "./e2e",
	use: {
		baseURL: "http://localhost:5173",
		screenshot: "only-on-failure",
		trace: "retain-on-failure"
	},
	webServer: {
		command: "pnpm db:migrate:local && pnpm dev --host 127.0.0.1",
		reuseExistingServer: !process.env.CI,
		stderr: "pipe",
		stdout: "pipe",
		timeout: 120_000,
		url: "http://localhost:5173"
	},
	workers: process.env.CI ? 2 : undefined,
	projects: [
		{ name: "chromium", use: { ...devices["Desktop Chrome"] } },
		{ name: "mobile-chromium", use: { ...devices["Pixel 7"] } }
	]
});
