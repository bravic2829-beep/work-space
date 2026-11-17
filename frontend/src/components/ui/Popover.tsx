"use client";

import {
  cloneElement,
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";

import { createPortal } from "react-dom";

import { cn } from "@/lib/cn";

type PopoverState = {
  open: boolean;
  setOpen: (open: boolean) => void;
  contentId: string;
  triggerRef: React.RefObject<HTMLElement | null>;
  /** The panel itself, which may be drawn outside the popover's own element (see `floating`). */
  contentRef: React.RefObject<HTMLDivElement | null>;
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
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      const inside = rootRef.current?.contains(target) || contentRef.current?.contains(target);
      if (!inside) setOpen(false);
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
    <PopoverContext.Provider value={{ open, setOpen, contentId, triggerRef, contentRef }}>
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
  floating = false,
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & {
  align?: keyof typeof ALIGN;
  /**
   * Draw the panel over the whole page instead of inside its parent, for a popover in a table or
   * another box that clips what sticks out of it. It closes when the page scrolls.
   */
  floating?: boolean;
}) {
  const { open, setOpen, contentId, triggerRef, contentRef } = usePopover();
  const [spot, setSpot] = useState<{ top: number; left?: number; right?: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !floating) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setSpot({
      top: rect.bottom + 4,
      ...(align === "end" ? { right: window.innerWidth - rect.right } : { left: rect.left }),
    });
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, floating, align, triggerRef, setOpen]);

  if (!open) return null;
  const panel = (
    <div
      ref={contentRef}
      id={contentId}
      role="dialog"
      style={floating ? { position: "fixed", ...spot } : undefined}
      className={cn(
        "z-30 w-60 rounded-lg border border-line-strong bg-surface p-1.5 text-sm text-fg shadow-lg",
        floating ? "z-50" : cn("absolute top-full mt-1", ALIGN[align]),
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
  return floating ? createPortal(panel, document.body) : panel;
}
