import type { ReactNode } from "react";

import styles from "./DataTableFrame.module.css";

interface Props {
	readonly children: ReactNode;
	readonly className?: string;
}

export function DataTableFrame({ children, className }: Props) {
	return <div className={[styles.frame, className].filter(Boolean).join(" ")}>{children}</div>;
}
