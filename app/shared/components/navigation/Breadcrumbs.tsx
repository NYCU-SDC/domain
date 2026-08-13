import { Link } from "react-router";

import styles from "./Breadcrumbs.module.css";

export function Breadcrumbs({ current }: { readonly current: string }) {
	return (
		<nav className={styles.breadcrumbs} aria-label="麵包屑">
			<ol>
				<li>
					<Link to="/">首頁</Link>
				</li>
				<li>
					<span aria-current="page">{current}</span>
				</li>
			</ol>
		</nav>
	);
}
