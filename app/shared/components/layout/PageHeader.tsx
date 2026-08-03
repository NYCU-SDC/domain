import type { ReactNode } from "react";

import styles from "./PageHeader.module.css";

export function PageHeader({ actions, description, title }: { actions?: ReactNode; description: string; title: string }) {
	return (
		<header className={styles.header}>
			<div>
				<h1>{title}</h1>
				<p>{description}</p>
			</div>
			{actions ? <div className={styles.actions}>{actions}</div> : null}
		</header>
	);
}
