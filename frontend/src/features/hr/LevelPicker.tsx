"use client";

import { useId } from "react";

import { cn } from "@/lib/cn";
import { LEVEL_HELP, LEVEL_LABELS, type UserLevel } from "@/features/auth/schema";

const LEVELS = Object.keys(LEVEL_LABELS) as UserLevel[];

/** The four levels as cards, each with a line on what it allows. Real radio buttons underneath. */
export function LevelPicker({
  value,
  onChange,
  disabled,
}: {
  value: UserLevel;
  onChange: (level: UserLevel) => void;
  disabled?: boolean;
}) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label="Level" className="grid gap-1.5">
      {LEVELS.map((level) => {
        const checked = level === value;
        return (
          <label
            key={level}
            className={cn(
              "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 has-focus-visible:outline-2 has-focus-visible:outline-primary",
              checked ? "border-primary bg-primary-soft" : "border-line-strong hover:bg-surface-muted",
              disabled && "cursor-not-allowed opacity-60",
            )}
          >
            <input
              type="radio"
              name={name}
              value={level}
              checked={checked}
              disabled={disabled}
              onChange={() => onChange(level)}
              className="mt-1"
            />
            <span className="flex flex-col leading-snug">
              <span className="text-[13px] font-medium">{LEVEL_LABELS[level]}</span>
              <span className="text-xs text-muted">{LEVEL_HELP[level]}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
