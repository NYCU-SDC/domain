import type { MetaDescriptor } from "react-router";

const SITE_ORIGIN = "https://nycu.club";
const SITE_NAME = "nycu.club 社團子網域管理平台";
const SOCIAL_IMAGE = `${SITE_ORIGIN}/og-image.png`;
const SOCIAL_IMAGE_ALT = "nycu.club 社團子網域管理平台";

type JsonLdPrimitive = boolean | null | number | string;
type JsonLdValue = JsonLdObject | JsonLdPrimitive | readonly JsonLdValue[];
interface JsonLdObject {
	readonly [key: string]: JsonLdValue | undefined;
}

interface PublicMetaOptions {
	readonly description: string;
	readonly path: `/${string}` | "/";
	readonly structuredData?: JsonLdObject | readonly JsonLdObject[];
	readonly title: string;
}

export function createPublicMeta({ description, path, structuredData, title }: PublicMetaOptions): MetaDescriptor[] {
	const url = new URL(path, SITE_ORIGIN).toString();
	return [
		{ title },
		{ content: description, name: "description" },
		{ content: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1", name: "robots" },
		{ href: url, rel: "canonical", tagName: "link" },
		{ content: "website", property: "og:type" },
		{ content: SITE_NAME, property: "og:site_name" },
		{ content: title, property: "og:title" },
		{ content: description, property: "og:description" },
		{ content: url, property: "og:url" },
		{ content: "zh_TW", property: "og:locale" },
		{ content: SOCIAL_IMAGE, property: "og:image" },
		{ content: "1200", property: "og:image:width" },
		{ content: "630", property: "og:image:height" },
		{ content: SOCIAL_IMAGE_ALT, property: "og:image:alt" },
		{ content: "summary_large_image", name: "twitter:card" },
		{ content: title, name: "twitter:title" },
		{ content: description, name: "twitter:description" },
		{ content: SOCIAL_IMAGE, name: "twitter:image" },
		{ content: SOCIAL_IMAGE_ALT, name: "twitter:image:alt" },
		...(structuredData ? [{ "script:ld+json": structuredData } satisfies MetaDescriptor] : [])
	];
}

export function createPrivateMeta(title: string, description = "nycu.club 帳號與網域管理功能。"): MetaDescriptor[] {
	return [{ title }, { content: description, name: "description" }, { content: "noindex, nofollow, noarchive, nosnippet", name: "robots" }];
}

export const landingStructuredData: JsonLdObject = {
	"@context": "https://schema.org",
	"@graph": [
		{
			"@id": `${SITE_ORIGIN}/#organization`,
			"@type": "Organization",
			name: "交大軟體開發社",
			url: "https://sdc.nycu.club"
		},
		{
			"@id": `${SITE_ORIGIN}/#website`,
			"@type": "WebSite",
			inLanguage: "zh-Hant",
			name: "nycu.club",
			publisher: { "@id": `${SITE_ORIGIN}/#organization` },
			url: SITE_ORIGIN
		},
		{
			"@id": `${SITE_ORIGIN}/#application`,
			"@type": "WebApplication",
			applicationCategory: "DeveloperApplication",
			description: "讓陽明交通大學社團管理 nycu.club DNS、Cloudflare Proxy 與快取。",
			inLanguage: "zh-Hant",
			name: SITE_NAME,
			operatingSystem: "Web",
			provider: { "@id": `${SITE_ORIGIN}/#organization` },
			url: SITE_ORIGIN
		}
	]
};
