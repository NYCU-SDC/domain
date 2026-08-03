import { Inbox } from "lucide-react";
import type { ReactNode } from "react";

import styles from "./EmptyState.module.css";

export function EmptyState({ action, description, title }: { action?: ReactNode; description: string; title: string }) {
	return (
		<div className={styles.empty}>
			<span>
				<Inbox aria-hidden="true" />
			</span>
			<h2>{title}</h2>
			<p>{description}</p>
			{action}
		</div>
	);
}
