"use client";

import { X } from "lucide-react";
import { useId } from "react";

import { cn } from "@/lib/cn";

import { inkFor, optionColor } from "./colors";

export type Choice = { id: string; name: string; color?: string; kind?: string };

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
 * A small round X at the end empties the choice (a radio button cannot be un-picked otherwise).
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
      {options.map((option, index) => {
        const checked = value.includes(option.id);
        // A chosen option is filled with its color; the others show it as a dot.
        const color = optionColor(option, index);
        return (
          <label
            key={option.id}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium select-none has-focus-visible:outline-2 has-focus-visible:outline-primary",
              checked ? "border-transparent" : "border-line-strong bg-surface text-fg hover:border-primary",
              disabled && "cursor-not-allowed opacity-60 hover:border-line-strong",
            )}
            style={checked ? { backgroundColor: color, color: inkFor(color).color } : undefined}
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
            {!checked && (
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: color }}
              />
            )}
            {option.name}
          </label>
        );
      })}
      {value.length > 0 && !disabled && (
        <button
          type="button"
          aria-label={multiple ? "Clear all choices" : "Clear choice"}
          title={multiple ? "Clear all" : "Clear"}
          onClick={() => onChange([])}
          className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full border border-line-strong bg-surface p-0 text-muted hover:border-danger hover:text-danger focus-visible:outline-2 focus-visible:outline-primary"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      )}
    </div>
  );
}
