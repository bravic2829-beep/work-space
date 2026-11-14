"use client";

import { useId } from "react";

import { cn } from "@/lib/cn";

export type SegmentOption<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  /** Names the group for screen readers. */
  label: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
};

/**
 * A few choices side by side, one of them picked (a filter, or a type). Built on real radio
 * buttons, so the keyboard and screen readers work like they do for any radio group.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
  className,
}: Props<T>) {
  const name = useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "inline-flex h-7 items-center gap-0.5 rounded border border-line-strong bg-surface p-0.5",
        className,
      )}
    >
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <label
            key={option.value}
            className={cn(
              "inline-flex h-full cursor-pointer items-center rounded-[3px] px-2.5 text-xs font-medium has-focus-visible:outline-2 has-focus-visible:outline-primary",
              checked ? "bg-primary-soft text-primary" : "text-muted hover:text-fg",
              disabled && "cursor-not-allowed opacity-50",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={checked}
              disabled={disabled}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        );
      })}
    </div>
  );
}
