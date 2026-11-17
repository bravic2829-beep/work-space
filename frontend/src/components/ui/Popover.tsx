"use client";

import {
  cloneElement,
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
} from "react";

import { cn } from "@/lib/cn";

type PopoverState = {
  open: boolean;
  setOpen: (open: boolean) => void;
  contentId: string;
  triggerRef: React.RefObject<HTMLElement | null>;
};

const PopoverContext = createContext<PopoverState | null>(null);

function usePopover(): PopoverState {
  const state = useContext(PopoverContext);
  if (!state) throw new Error("Popover parts must be used inside <Popover>.");
  return state;
}

/** Closes the popover this is used in (for example after a menu item was chosen). */
export function usePopoverClose(): () => void {
  const { setOpen } = usePopover();
  return () => setOpen(false);
}

/**
 * A small panel that opens under its trigger. It closes on Escape (focus goes back to the
 * trigger) and on a click anywhere outside.
 *
 *   <Popover>
 *     <PopoverTrigger render={<Button>Open</Button>} />
 *     <PopoverContent align="end">…</PopoverContent>
 *   </Popover>
 */
export function Popover({ children, className }: { children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const triggerRef = useRef<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <PopoverContext.Provider value={{ open, setOpen, contentId, triggerRef }}>
      <div ref={rootRef} className={cn("relative inline-block", className)}>
        {children}
      </div>
    </PopoverContext.Provider>
  );
}

type TriggerProps = {
  /** The element that opens the popover (usually a Button). It gets the click and ARIA props. */
  render: ReactElement<Record<string, unknown>>;
} & Record<string, unknown>;

/** Turns the element given in `render` into the button that opens the popover. */
export function PopoverTrigger({ render, ...rest }: TriggerProps) {
  const { open, setOpen, contentId, triggerRef } = usePopover();
  const own = render.props.onClick as ((event: React.MouseEvent) => void) | undefined;
  return cloneElement(render, {
    ...rest,
    ref: triggerRef,
    "aria-haspopup": "dialog",
    "aria-expanded": open,
    "aria-controls": open ? contentId : undefined,
    onClick: (event: React.MouseEvent) => {
      own?.(event);
      (rest.onClick as ((event: React.MouseEvent) => void) | undefined)?.(event);
      setOpen(!open);
    },
  });
}

const ALIGN = {
  start: "left-0",
  center: "left-1/2 -translate-x-1/2",
  end: "right-0",
} as const;

export function PopoverContent({
  align = "start",
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { align?: keyof typeof ALIGN }) {
  const { open, contentId } = usePopover();
  if (!open) return null;
  return (
    <div
      id={contentId}
      role="dialog"
      className={cn(
        "absolute top-full z-30 mt-1 w-60 rounded-lg border border-line-strong bg-surface p-1.5 text-sm text-fg shadow-lg",
        ALIGN[align],
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
