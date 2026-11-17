"use client";

import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/cn";

import { Popover, PopoverContent, PopoverTrigger, usePopoverClose } from "./Popover";

export type MenuItem = {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  /** Greyed out and not clickable; `hint` says why (shown on hover). */
  disabled?: boolean;
  hint?: string;
};

function Items({ items }: { items: MenuItem[] }) {
  const close = usePopoverClose();
  return (
    <ul role="menu" className="m-0 list-none p-0">
      {items.map(({ label, icon: Icon, onSelect, disabled, hint }) => (
        <li key={label} role="none">
          <button
            type="button"
            role="menuitem"
            disabled={disabled}
            title={disabled ? hint : undefined}
            className="flex w-full justify-start gap-2 rounded border-0 bg-transparent px-2.5 py-1.5 text-left text-[13px] font-normal hover:bg-surface-muted"
            onClick={() => {
              close();
              onSelect();
            }}
          >
            {Icon && <Icon className="size-4 shrink-0 text-muted" aria-hidden />}
            {label}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * A list of actions that opens under a button. Pass the button as `trigger` (it gets the click and
 * the ARIA props); choosing an item closes the list and runs it.
 */
export function Menu({
  trigger,
  items,
  align = "end",
  className,
}: {
  trigger: React.ReactElement<Record<string, unknown>>;
  items: MenuItem[];
  align?: "start" | "end";
  className?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger render={trigger} />
      <PopoverContent align={align} floating className={cn("w-48", className)}>
        <Items items={items} />
      </PopoverContent>
    </Popover>
  );
}
