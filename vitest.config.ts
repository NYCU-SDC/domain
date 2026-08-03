import path from "node:path";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [
		cloudflareTest(async () => {
			const migrations = await readD1Migrations(path.join(import.meta.dirname, "drizzle"));
			return {
				miniflare: {
					bindings: {
						AUTH_SECRET: "test-auth-secret-with-at-least-thirty-two-characters",
						BOOTSTRAP_ADMIN_GITHUB_IDS: "9001",
						CLOUDFLARE_API_TOKEN: "test-cloudflare-token",
						DISCORD_APPLICATION_WEBHOOK_URL: "https://discord.com/api/webhooks/123456789/test-webhook-token",
						GITHUB_CLIENT_ID: "test-github-client-id",
						GITHUB_CLIENT_SECRET: "test-github-client-secret-at-least-thirty-two-chars",
						IP_HASH_SECRET: "test-ip-hash-secret-with-at-least-thirty-two-characters",
						TEST_MIGRATIONS: migrations
					}
				},
				wrangler: { configPath: "./wrangler.jsonc" }
			};
		})
	],
	resolve: {
		alias: {
			"~": path.resolve(import.meta.dirname, "app")
		}
	},
	test: {
		include: ["tests/**/*.test.ts"],
		setupFiles: ["./tests/setup.ts"]
	}
});
