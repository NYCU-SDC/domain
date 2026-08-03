import { getAppConfig } from "~/server/config.server";
import { getWorkerRuntime } from "~/server/runtime.server";
import type { Route } from "./+types/sitemap";

const publicPaths = ["/", "/apply", "/docs", "/security"] as const;

function escapeXml(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export function loader({ context }: Route.LoaderArgs) {
	const config = getAppConfig(getWorkerRuntime(context).env);
	const urls = publicPaths.map(path => `  <url><loc>${escapeXml(new URL(path, config.appOrigin).toString())}</loc></url>`).join("\n");
	const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
	return new Response(body, {
		headers: {
			"Cache-Control": "public, max-age=3600",
			"Content-Type": "application/xml; charset=utf-8"
		}
	});
}
