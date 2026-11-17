"use client";

import { X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

import { Button } from "./Button";

type ToastAction = { label: string; onClick: () => void };
type ToastItem = { id: number; message: string; action?: ToastAction };
type Show = (message: string, options?: { action?: ToastAction }) => void;

const SHOW_FOR_MS = 6000;

// Outside a provider (a unit test of one screen) showing a toast does nothing.
const ToastContext = createContext<Show>(() => undefined);

/** Shows a short message in the corner of the page, without moving anything else. */
export function useToast(): Show {
  return useContext(ToastContext);
}

/** Keeps the toasts of the page. Put it once around the pages that show them. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const show = useCallback<Show>(
    (message, options) => {
      const id = nextId.current++;
      setItems((current) => [...current, { id, message, action: options?.action }]);
      window.setTimeout(() => dismiss(id), SHOW_FOR_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2"
      >
        {items.map((item) => (
          <div
            key={item.id}
            className="pointer-events-auto flex items-center gap-3 rounded-lg bg-fg px-3 py-2.5 text-[13px] text-bg shadow-lg"
          >
            <span>{item.message}</span>
            {item.action && (
              <button
                type="button"
                className="cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-bg underline hover:bg-transparent"
                onClick={() => {
                  item.action?.onClick();
                  dismiss(item.id);
                }}
              >
                {item.action.label}
              </button>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="size-5 text-bg hover:bg-bg/20"
              aria-label="Dismiss"
              onClick={() => dismiss(item.id)}
            >
              <X className="size-3.5" aria-hidden />
            </Button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
