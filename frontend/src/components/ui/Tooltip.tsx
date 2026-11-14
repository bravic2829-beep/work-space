"use client";

import {
  cloneElement,
  createContext,
  useContext,
  useId,
  useState,
  type ReactElement,
} from "react";

import { cn } from "@/lib/cn";

type TooltipState = { open: boolean; setOpen: (open: boolean) => void; id: string };

const TooltipContext = createContext<TooltipState | null>(null);

function useTooltip(): TooltipState {
  const state = useContext(TooltipContext);
  if (!state) throw new Error("Tooltip parts must be used inside <Tooltip>.");
  return state;
}

/**
 * A short hint that shows when the trigger is hovered or focused (so the keyboard gets it too)
 * and goes away on leave, blur, click or Escape.
 *
 *   <Tooltip>
 *     <TooltipTrigger render={<Button>Hover</Button>} />
 *     <TooltipContent>Add to library</TooltipContent>
 *   </Tooltip>
 */
export function Tooltip({ children, className }: { children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <TooltipContext.Provider value={{ open, setOpen, id }}>
      <span className={cn("relative inline-flex", className)}>{children}</span>
    </TooltipContext.Provider>
  );
}

type Handler = (event: never) => void;

function chain(own: unknown, ours: () => void): Handler {
  return (event) => {
    (own as ((event: never) => void) | undefined)?.(event);
    ours();
  };
}

/** Turns the element given in `render` into the thing that shows the tooltip. */
export function TooltipTrigger({ render }: { render: ReactElement<Record<string, unknown>> }) {
  const { setOpen, id } = useTooltip();
  const props = render.props;
  return cloneElement(render, {
    "aria-describedby": id,
    onMouseEnter: chain(props.onMouseEnter, () => setOpen(true)),
    onMouseLeave: chain(props.onMouseLeave, () => setOpen(false)),
    onFocus: chain(props.onFocus, () => setOpen(true)),
    onBlur: chain(props.onBlur, () => setOpen(false)),
    onClick: chain(props.onClick, () => setOpen(false)),
    onKeyDown: (event: React.KeyboardEvent) => {
      (props.onKeyDown as ((event: React.KeyboardEvent) => void) | undefined)?.(event);
      if (event.key === "Escape") setOpen(false);
    },
  });
}

const SIDE = {
  bottom: "top-full mt-1.5",
  top: "bottom-full mb-1.5",
} as const;

const ALIGN = {
  start: "left-0",
  center: "left-1/2 -translate-x-1/2",
  end: "right-0",
} as const;

export function TooltipContent({
  side = "bottom",
  align = "center",
  className,
  children,
}: {
  side?: keyof typeof SIDE;
  align?: keyof typeof ALIGN;
  className?: string;
  children: React.ReactNode;
}) {
  const { open, id } = useTooltip();
  if (!open) return null;
  return (
    <span
      id={id}
      role="tooltip"
      className={cn(
        "pointer-events-none absolute z-40 rounded bg-fg px-2 py-1 text-xs font-medium whitespace-nowrap text-surface shadow-md",
        SIDE[side],
        ALIGN[align],
        className,
      )}
    >
      {children}
    </span>
  );
}
