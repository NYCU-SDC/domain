import { Outlet } from "react-router";

import { PublicFooter } from "./PublicFooter";
import { PublicHeader } from "./PublicHeader";
import styles from "./PublicLayout.module.css";

export default function PublicLayout() {
	return (
		<div className={styles.page}>
			<PublicHeader />
			<div className={styles.content}>
				<Outlet />
			</div>
			<PublicFooter />
		</div>
	);
}
