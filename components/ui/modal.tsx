"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Cross1Icon, ExclamationTriangleIcon } from "@radix-ui/react-icons";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** id of the element naming the dialog; wired to aria-labelledby. */
  labelledBy: string;
  children: React.ReactNode;
  className?: string;
  /** Set false for destructive confirmations, where a stray click shouldn't dismiss. */
  dismissOnBackdrop?: boolean;
}

/**
 * Accessible dialog shell.
 *
 * Replaces the bare `fixed inset-0` div this app used to render, which had no
 * dialog semantics and let keyboard focus wander into the page behind a
 * visually blocking overlay. Handles the five things a modal owes the user:
 * a name and role, Escape, a focus trap, focus restoration on close, and a
 * scroll lock so the page underneath doesn't drift.
 */
export function Modal({
  open,
  onClose,
  labelledBy,
  children,
  className,
  dismissOnBackdrop = true,
}: ModalProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const restoreFocusRef = React.useRef<HTMLElement | null>(null);

  // Remember the trigger before the dialog steals focus, then move focus in.
  React.useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    return () => {
      // Only restore if the trigger is still in the document; a row that was
      // deleted while the dialog was open would otherwise throw focus to body.
      const target = restoreFocusRef.current;
      if (target && document.contains(target)) target.focus();
    };
  }, [open]);

  // Escape closes; Tab cycles inside the panel.
  React.useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  // Freeze the page behind the overlay.
  React.useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-3 backdrop-blur-[2px] sm:p-6"
      onMouseDown={(event) => {
        if (dismissOnBackdrop && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={cn(
          "relative max-h-[95vh] w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-2xl outline-none dark:border-slate-700 dark:bg-slate-900",
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "destructive" | "default";
  isPending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Themed replacement for `window.confirm`, which ignored the app's theme, could
 * not carry accurate copy about what deletion actually does here, and is
 * suppressible by the browser.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "destructive",
  isPending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = React.useId();

  return (
    <Modal
      open={open}
      onClose={isPending ? () => {} : onCancel}
      labelledBy={titleId}
      dismissOnBackdrop={false}
      className="max-w-md"
    >
      <div className="p-6">
        <div className="flex items-start gap-3">
          {tone === "destructive" ? (
            <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300">
              <ExclamationTriangleIcon className="h-4 w-4" />
            </span>
          ) : null}
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-lg font-semibold text-slate-900 dark:text-slate-100"
            >
              {title}
            </h2>
            <div className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              {description}
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isPending}
            className="sm:w-auto"
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={tone === "destructive" ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={isPending}
            className="sm:w-auto"
          >
            {isPending ? "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Shared close affordance for dialog headers. */
export function ModalCloseButton({ onClose }: { onClose: () => void }) {
  return (
    <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close dialog">
      <Cross1Icon className="h-4 w-4" />
    </Button>
  );
}
