"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { ColorPicker } from "./ColorPicker";

type Props = {
  /** The option being colored, for the accessible name. */
  label: string;
  current: string;
  onPick: (hex: string) => void;
  onCancel: () => void;
};

/**
 * The color dialog as a window in the middle of the page, over everything (like the Colors window
 * of a spreadsheet). It belongs to no panel: it is drawn on the page itself, so it is not cut off
 * by the side panel that opened it. Escape and a click outside cancel; Escape does not reach the
 * panel behind, so only the dialog closes.
 */
export function ColorModal({ label, current, onPick, onCancel }: Props) {
  const panel = useRef<HTMLDivElement | null>(null);
  const cancel = useRef(onCancel);

  useEffect(() => {
    cancel.current = onCancel;
  });

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopImmediatePropagation();
      cancel.current();
    }
    // In the capture phase, so the panel behind never sees the key.
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      if (before?.isConnected) before.focus();
    };
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-fg/40 p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={`Colors for ${label}`}
        tabIndex={-1}
        className="max-h-full w-[min(34rem,100%)] overflow-auto rounded-lg border border-line-strong bg-surface text-fg shadow-2xl outline-none"
      >
        <div className="flex items-center justify-between border-b border-line bg-surface-muted py-1.5 pr-1.5 pl-4">
          <h2 className="m-0 text-sm font-semibold">Colors</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onCancel}
            className="inline-flex size-7 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-muted hover:bg-line hover:text-fg"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
        <ColorPicker label={label} current={current} onPick={onPick} onCancel={onCancel} />
      </div>
    </div>,
    document.body,
  );
}
