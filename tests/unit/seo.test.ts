import { describe, expect, it } from "vitest";

import { createPrivateMeta, createPublicMeta, landingStructuredData } from "../../app/shared/lib/seo";

describe("SEO metadata", () => {
	it("builds a canonical and complete social metadata set for public routes", () => {
		const descriptors = createPublicMeta({
			description: "Route description",
			path: "/apply",
			structuredData: landingStructuredData,
			title: "Route title"
		});
		expect(descriptors).toContainEqual({ href: "https://nycu.club/apply", rel: "canonical", tagName: "link" });
		expect(descriptors).toContainEqual({ content: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1", name: "robots" });
		expect(descriptors).toContainEqual({ content: "https://nycu.club/og-image.png", property: "og:image" });
		expect(descriptors).toContainEqual({ content: "summary_large_image", name: "twitter:card" });
		expect(descriptors).toContainEqual({ "script:ld+json": landingStructuredData });
	});

	it("prevents account and management routes from being indexed", () => {
		expect(createPrivateMeta("Dashboard")).toContainEqual({ content: "noindex, nofollow, noarchive, nosnippet", name: "robots" });
	});
});
