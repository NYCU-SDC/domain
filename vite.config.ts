import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

const e2eAppOrigin = process.env.E2E_APP_ORIGIN;

export default defineConfig({
	plugins: [
		cloudflare({
			config: e2eAppOrigin
				? config => ({
						vars: { ...config.vars, APP_ORIGIN: e2eAppOrigin }
					})
				: undefined,
			viteEnvironment: { name: "ssr" }
		}),
		reactRouter()
	],
	resolve: {
		tsconfigPaths: true
	}
});
