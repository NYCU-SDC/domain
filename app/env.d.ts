export {};

declare global {
	interface Env {
		readonly AUTH_SECRET: string;
		readonly CLOUDFLARE_API_TOKEN: string;
		readonly DISCORD_APPLICATION_WEBHOOK_URL: string;
		readonly GITHUB_CLIENT_ID: string;
		readonly GITHUB_CLIENT_SECRET: string;
		readonly IP_HASH_SECRET: string;
	}

	namespace Cloudflare {
		interface Env {
			readonly AUTH_SECRET: string;
			readonly CLOUDFLARE_API_TOKEN: string;
			readonly DISCORD_APPLICATION_WEBHOOK_URL: string;
			readonly GITHUB_CLIENT_ID: string;
			readonly GITHUB_CLIENT_SECRET: string;
			readonly IP_HASH_SECRET: string;
		}
	}
}
