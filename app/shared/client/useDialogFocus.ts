import { useEffect, type RefObject } from "react";

const focusableSelector = [
	'a[href]:not([tabindex="-1"])',
	'button:not([disabled]):not([tabindex="-1"])',
	'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
	'select:not([disabled]):not([tabindex="-1"])',
	'textarea:not([disabled]):not([tabindex="-1"])',
	'[tabindex]:not([tabindex="-1"])'
].join(",");

export function useDialogFocus<T extends HTMLElement>(open: boolean, dialogRef: RefObject<T | null>, onClose: () => void): void {
	useEffect(() => {
		if (!open) return;
		const dialog = dialogRef.current;
		if (!dialog) return;
		const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const getFocusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(element => !element.hidden && element.getAttribute("aria-hidden") !== "true");
		(getFocusable()[0] ?? dialog).focus();

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				onClose();
				return;
			}
			if (event.key !== "Tab") return;
			const focusable = getFocusable();
			if (!focusable.length) {
				event.preventDefault();
				dialog.focus();
				return;
			}
			const first = focusable[0];
			const last = focusable.at(-1) ?? first;
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};

		dialog.addEventListener("keydown", handleKeyDown);
		return () => {
			dialog.removeEventListener("keydown", handleKeyDown);
			previouslyFocused?.focus();
		};
	}, [dialogRef, onClose, open]);
}
