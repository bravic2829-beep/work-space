"use client";

import { useId } from "react";

import { cn } from "@/lib/cn";

export type Choice = { id: string; name: string };

type Props = {
  /** Names the group for screen readers. */
  label: string;
  options: Choice[];
  /** The ids that are picked. */
  value: string[];
  onChange: (value: string[]) => void;
  /** One choice (radio buttons) or several (checkboxes). */
  multiple: boolean;
  disabled?: boolean;
};

/**
 * The choices of a select field as pills, all in view: one tap to pick, no dropdown to open.
 * Built on real radio buttons / checkboxes, so the keyboard and screen readers work as usual.
 */
export function ChoiceChips({ label, options, value, onChange, multiple, disabled }: Props) {
  const name = useId();

  function toggle(id: string, checked: boolean) {
    if (!multiple) return onChange([id]);
    onChange(checked ? [...value, id] : value.filter((other) => other !== id));
  }

  if (options.length === 0) {
    return <p className="m-0 text-sm text-muted">No options yet. Add them in Manage fields.</p>;
  }

  return (
    <div
      role={multiple ? "group" : "radiogroup"}
      aria-label={label}
      className="flex flex-wrap items-center gap-1.5"
    >
      {options.map((option) => {
        const checked = value.includes(option.id);
        return (
          <label
            key={option.id}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1 rounded-full border px-3 py-1 text-sm font-medium select-none has-focus-visible:outline-2 has-focus-visible:outline-primary",
              checked
                ? "border-primary bg-primary-soft text-primary"
                : "border-line-strong bg-surface text-fg hover:border-primary",
              disabled && "cursor-not-allowed opacity-60 hover:border-line-strong",
            )}
          >
            <input
              type={multiple ? "checkbox" : "radio"}
              name={name}
              checked={checked}
              disabled={disabled}
              onChange={(event) => toggle(option.id, event.target.checked)}
              className="sr-only"
            />
            {checked && multiple && <span aria-hidden="true">✓</span>}
            {option.name}
          </label>
        );
      })}
      {!multiple && value.length > 0 && !disabled && (
        <button
          type="button"
          onClick={() => onChange([])}
          className="cursor-pointer border-0 bg-transparent px-1 text-xs text-muted underline hover:text-fg"
        >
          Clear
        </button>
      )}
    </div>
  );
}
