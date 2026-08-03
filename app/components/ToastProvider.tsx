import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import styles from "./ToastProvider.module.css";

type ToastTone = "error" | "info" | "success";

interface Toast {
	readonly id: string;
	readonly message: string;
	readonly tone: ToastTone;
}

interface ToastContextValue {
	readonly showToast: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
	const [toasts, setToasts] = useState<Toast[]>([]);
	const dismiss = useCallback((id: string) => {
		setToasts(current => current.filter(toast => toast.id !== id));
	}, []);
	const showToast = useCallback(
		(message: string, tone: ToastTone = "info") => {
			const id = crypto.randomUUID();
			setToasts(current => [...current.slice(-3), { id, message, tone }]);
			window.setTimeout(() => dismiss(id), 5000);
		},
		[dismiss]
	);
	const value = useMemo(() => ({ showToast }), [showToast]);
	return (
		<ToastContext.Provider value={value}>
			{children}
			<div className={styles.viewport} aria-live="polite" aria-label="通知">
				{toasts.map(toast => {
					const Icon = toast.tone === "success" ? CheckCircle2 : toast.tone === "error" ? CircleAlert : Info;
					return (
						<div className={styles.toast} data-tone={toast.tone} key={toast.id} role="status">
							<Icon aria-hidden="true" />
							<span>{toast.message}</span>
							<button aria-label="關閉通知" onClick={() => dismiss(toast.id)} type="button">
								<X />
							</button>
						</div>
					);
				})}
			</div>
		</ToastContext.Provider>
	);
}

export function useToast(): ToastContextValue {
	const context = useContext(ToastContext);
	if (!context) throw new Error("useToast must be used within ToastProvider");
	return context;
}
