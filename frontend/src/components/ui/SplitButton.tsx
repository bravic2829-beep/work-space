"use client";

import { ChevronDown, type LucideIcon } from "lucide-react";

import { Button, type ButtonProps } from "./Button";
import { Menu, type MenuItem } from "./Menu";

/**
 * A main action with a small arrow beside it: the button does the main action, the arrow opens
 * the other related actions.
 */
export function SplitButton({
  label,
  icon,
  onClick,
  items,
  variant = "primary",
  moreLabel,
}: {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  items: MenuItem[];
  variant?: ButtonProps["variant"];
  /** Names the arrow button for screen readers. */
  moreLabel: string;
}) {
  return (
    <span className="inline-flex">
      <Button size="sm" variant={variant} icon={icon} onClick={onClick} className="rounded-r-none">
        {label}
      </Button>
      <Menu
        trigger={
          <Button
            size="sm"
            variant={variant}
            aria-label={moreLabel}
            className="rounded-l-none border-l border-l-primary-fg/30 px-1.5"
          >
            <ChevronDown className="size-4" aria-hidden />
          </Button>
        }
        items={items}
      />
    </span>
  );
}
