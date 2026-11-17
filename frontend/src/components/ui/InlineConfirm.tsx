"use client";

import type { LucideIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "./Button";

type Props = {
  /** The button that starts the action, for example "Delete". */
  label: string;
  /** The question that replaces it, for example "Delete Team A?". */
  prompt: string;
  /** The button that does it, for example "Yes, delete". */
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  /** Show only this icon instead of the label (the label stays as the accessible name). */
  icon?: LucideIcon;
  /**
   * Ask from outside, for example when "Delete" was chosen in a menu: `open` says whether the
   * question is showing, and `hideTrigger` leaves out the button that would open it.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
};

/**
 * A risky action that asks "are you sure?" in the same place instead of in a pop-up window:
 * nothing moves, and Cancel is right beside the answer.
 */
export function InlineConfirm({
  label,
  prompt,
  confirmLabel,
  onConfirm,
  disabled,
  icon: Icon,
  open,
  onOpenChange,
  hideTrigger = false,
}: Props) {
  const [ownAsking, setOwnAsking] = useState(false);
  const asking = open ?? ownAsking;
  const setAsking = onOpenChange ?? setOwnAsking;

  if (!asking) {
    if (hideTrigger) return null;
    return (
      <Button
        size={Icon ? "icon" : "sm"}
        variant="ghost"
        className={Icon ? "size-7" : undefined}
        disabled={disabled}
        aria-label={Icon ? label : undefined}
        title={Icon ? label : undefined}
        onClick={() => setAsking(true)}
      >
        {Icon ? <Icon className="size-4" aria-hidden /> : label}
      </Button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-xs text-muted">{prompt}</span>
      <Button
        size="sm"
        variant="danger"
        disabled={disabled}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
        Cancel
      </Button>
    </span>
  );
}
