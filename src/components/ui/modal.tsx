"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "./icons";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** "sheet" slides up from the bottom on small screens — used for filters on mobile. */
  variant?: "dialog" | "sheet";
}

/**
 * Accessible modal built on the native <dialog> element: focus is trapped, Escape closes it, and
 * focus returns to the triggering element on close.
 */
export function Modal({ open, onClose, title, children, footer, variant = "dialog" }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        // Clicking the backdrop (the dialog element itself) closes the modal.
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        "m-auto max-h-[90dvh] w-full max-w-lg overflow-hidden rounded-3xl bg-white p-0 text-ink shadow-float backdrop:bg-ink/40 backdrop:backdrop-blur-sm",
        variant === "sheet" &&
          "max-sm:mt-auto max-sm:mb-0 max-sm:max-h-[92dvh] max-sm:max-w-none max-sm:rounded-b-none",
      )}
    >
      <div className="flex max-h-[inherit] flex-col">
        <header className="flex items-center justify-between border-b border-ink/10 px-5 py-4">
          <h2 id={titleId} className="font-sans text-lg font-bold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 rounded-full p-2 text-mist hover:bg-ink/5 hover:text-ink"
            aria-label="Close"
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <footer className="border-t border-ink/10 px-5 py-4">{footer}</footer>}
      </div>
    </dialog>
  );
}
