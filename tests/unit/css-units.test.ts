import { describe, expect, it } from "vitest";

const stylesheets = import.meta.glob<string>("../../app/**/*.css", {
	eager: true,
	import: "default",
	query: "?inline"
});

describe("CSS units", () => {
	it("uses rem instead of px except for one-pixel details", () => {
		const violations: string[] = [];
		const pxPattern = /(^|[^A-Za-z0-9_-])(-?(?:\d*\.)?\d+)px/gu;

		for (const [file, source] of Object.entries(stylesheets)) {
			for (const match of source.matchAll(pxPattern)) {
				const pixels = Number(match[2]);
				if (Math.abs(pixels) !== 1) violations.push(`${file}: ${match[2]}px`);
			}
		}

		expect(violations).toEqual([]);
	});
});
