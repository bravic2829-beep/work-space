"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";

import { cn } from "@/lib/cn";

import { Button } from "./Button";

type Props = {
  open: boolean;
  title: string;
  /** A line under the title, for example the employee code. */
  subtitle?: string;
  /** Something before the title, for example the avatar of the person the panel is about. */
  leading?: React.ReactNode;
  onClose: () => void;
  /** 480px instead of 380px, for a panel with a lot in it (a record with comments). */
  wide?: boolean;
  children: React.ReactNode;
};

const FIRST_FIELD = "input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled])";

/**
 * A panel that slides in from the right (380px, full width on a phone) for adding or editing one
 * thing without leaving the list. The list behind it stays usable on a wide screen. Escape and the
 * close button close it, the first field gets the focus, and the focus goes back to where it was.
 */
export function Drawer({ open, title, subtitle, leading, onClose, wide = false, children }: Props) {
  const titleId = useId();
  const panel = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const node = panel.current;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = node?.querySelector<HTMLElement>(FIRST_FIELD);
    (first ?? node)?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Give the focus back to what opened the drawer, unless the user has since moved it to
      // something else on the page. When the drawer's own button was focused, the browser has
      // already dropped the focus to <body> by the time this runs.
      const active = document.activeElement;
      const lost = !active || active === document.body || (node?.contains(active) ?? false);
      if (before && before.isConnected && lost) before.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <>
      {/* On a small screen the drawer covers the list, so a tap outside closes it. */}
      <div aria-hidden className="fixed inset-0 z-30 bg-fg/30 md:hidden" onClick={onClose} />
      <aside
        ref={panel}
        role="dialog"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-line bg-surface shadow-drawer outline-none",
          wide ? "max-w-[480px]" : "max-w-[380px]",
        )}
      >
        <header className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {leading}
            <div className="min-w-0">
              <h2 id={titleId} className="m-0 truncate text-base">
                {title}
              </h2>
              {subtitle && <p className="m-0 truncate font-mono text-xs text-muted">{subtitle}</p>}
            </div>
          </div>
          <Button variant="ghost" size="icon" aria-label="Close panel" onClick={onClose}>
            <X className="size-4" aria-hidden />
          </Button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </aside>
    </>
  );
}

/** The scrolling part of a drawer. */
export function DrawerBody({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex-1 space-y-4 overflow-y-auto p-4", className)} {...rest} />;
}

/** The buttons at the bottom of a drawer, always in view. */
export function DrawerFooter({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-center gap-2 border-t border-line bg-surface-muted px-4 py-3", className)}
      {...rest}
    />
  );
}
