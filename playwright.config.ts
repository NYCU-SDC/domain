import { defineConfig, devices } from "@playwright/test";

const port = process.env.E2E_PORT ?? "5173";
const baseURL = `http://localhost:${port}`;

export default defineConfig({
	expect: { timeout: 5_000 },
	fullyParallel: true,
	reporter: process.env.CI ? [["html", { open: "never" }], ["github"]] : "list",
	retries: process.env.CI ? 2 : 0,
	testDir: "./e2e",
	use: {
		baseURL,
		screenshot: "only-on-failure",
		trace: "retain-on-failure"
	},
	webServer: {
		command: `pnpm db:migrate:local && pnpm dev --host 127.0.0.1 --port ${port}`,
		env: {
			...process.env,
			CLOUDFLARE_INCLUDE_PROCESS_ENV: "true",
			E2E_APP_ORIGIN: baseURL,
			IP_HASH_SECRET: "playwright-only-ip-hash-secret-32-bytes"
		},
		reuseExistingServer: !process.env.CI,
		stderr: "pipe",
		stdout: "pipe",
		timeout: 120_000,
		url: baseURL
	},
	workers: process.env.CI ? 2 : undefined,
	projects: [
		{ name: "chromium", use: { ...devices["Desktop Chrome"] } },
		{ name: "mobile-chromium", use: { ...devices["Pixel 7"] } }
	]
});
