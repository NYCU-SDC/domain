import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";

function targetFromHash(hash: string): HTMLElement | null {
	if (!hash) return null;
	try {
		return document.getElementById(decodeURIComponent(hash.slice(1)));
	} catch {
		return null;
	}
}

function pageName(): string {
	const heading = document.querySelector("#main-content h1");
	const text = heading?.textContent?.replace(/\s+/gu, " ").trim();
	const title = document.title.split("｜")[0]?.trim();
	return text ?? title ?? "新頁面";
}

export function RouteAccessibility() {
	const location = useLocation();
	const [announcement, setAnnouncement] = useState("");
	const previousLocation = useRef({ hash: location.hash, pathname: location.pathname });

	useEffect(() => {
		const previous = previousLocation.current;
		if (previous.pathname === location.pathname && previous.hash === location.hash) return;

		const pageChanged = previous.pathname !== location.pathname;
		previousLocation.current = { hash: location.hash, pathname: location.pathname };
		const target = targetFromHash(location.hash) ?? document.getElementById("main-content");

		if (target) {
			target.focus({ preventScroll: true });
			if (location.hash) {
				target.scrollIntoView({ block: "start" });
			} else {
				window.scrollTo({ left: 0, top: 0 });
			}
		}

		if (!pageChanged) return;

		setAnnouncement("");
		const frame = window.requestAnimationFrame(() => {
			setAnnouncement(`頁面已載入：${pageName()}`);
		});
		return () => window.cancelAnimationFrame(frame);
	}, [location.hash, location.pathname]);

	return (
		<div className="srOnly" id="route-status" role="status" aria-atomic="true" aria-live="polite">
			{announcement}
		</div>
	);
}
