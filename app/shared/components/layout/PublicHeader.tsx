import { GitFork } from "lucide-react";
import { Link } from "react-router";

import styles from "./PublicHeader.module.css";

export function PublicHeader() {
	return (
		<header className={styles.header}>
			<nav className={styles.nav} aria-label="主要導覽">
				<Link className={`brand ${styles.wordmark}`} to="/" translate="no">
					nycu.club
				</Link>
				<div className={styles.links}>
					<Link to="/#manage">可以改什麼</Link>
					<Link to="/#faq">常見問題</Link>
				</div>
				<div className={styles.actions}>
					<Link className="button" to="/apply">
						申請子網域
					</Link>
					<Link className="button buttonPrimary" to="/login">
						<GitFork size={17} aria-hidden="true" />
						<span className={styles.loginLabel}>GitHub 登入</span>
					</Link>
				</div>
			</nav>
		</header>
	);
}
