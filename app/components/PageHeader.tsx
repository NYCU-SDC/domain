import type { ReactNode } from "react";

import styles from "./PageHeader.module.css";

export function PageHeader({
  actions,
  description,
  eyebrow,
  title,
}: {
  actions?: ReactNode;
  description: string;
  eyebrow?: string;
  title: string;
}) {
  return (
    <header className={styles.header}>
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  );
}
