import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export function ThemeToggle() {
	const [theme, setTheme] = useState<"dark" | "light" | null>(null);
	useEffect(() => {
		const saved = localStorage.getItem("nycu-theme");
		if (saved === "dark" || saved === "light") {
			document.documentElement.dataset.theme = saved;
			setTheme(saved);
		}
	}, []);
	const toggle = () => {
		const current = theme ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
		const next = current === "dark" ? "light" : "dark";
		document.documentElement.dataset.theme = next;
		localStorage.setItem("nycu-theme", next);
		setTheme(next);
	};
	const isDark = theme === "dark";
	return (
		<button
			className="button buttonGhost buttonSmall"
			onClick={toggle}
			type="button"
			aria-label={isDark ? "切換為 light mode" : "切換為 dark mode"}
			title={isDark ? "切換為 light mode" : "切換為 dark mode"}
		>
			{isDark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
		</button>
	);
}
