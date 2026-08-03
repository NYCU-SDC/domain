import { Link } from "react-router";

import styles from "./PublicFooter.module.css";

const footerLinks = [
	{ label: "使用說明", to: "/docs" },
	{ label: "申請子網域", to: "/apply" },
	{ label: "隱私與安全", to: "/security" }
] as const;

export function PublicFooter() {
	return (
		<footer className={styles.footer}>
			<div className={styles.identity}>
				<strong translate="no">nycu.club</strong>
				<p>
					由{" "}
					<a href="https://sdc.nycu.club" rel="noreferrer" target="_blank">
						交大軟體開發社
					</a>{" "}
					維護
				</p>
			</div>
			<nav aria-label="頁尾導覽">
				{footerLinks.map(link => (
					<Link key={link.to} to={link.to}>
						{link.label}
					</Link>
				))}
			</nav>
		</footer>
	);
}
