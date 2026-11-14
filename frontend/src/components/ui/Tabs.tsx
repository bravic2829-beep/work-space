"use client";

import type { LucideIcon } from "lucide-react";
import { useRef } from "react";

import { cn } from "@/lib/cn";

export type TabItem<T extends string> = {
  id: T;
  label: string;
  icon?: LucideIcon;
  /** A small number after the label, for example how many rows are in the tab. */
  count?: number;
};

type Props<T extends string> = {
  /** Names the group for screen readers. */
  label: string;
  tabs: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** The id prefix of the panels: the panel of tab "x" is `${idPrefix}-panel-x`. */
  idPrefix: string;
};

/** Tabs like the view switcher of the design: the active one is blue with an underline. */
export function Tabs<T extends string>({ label, tabs, value, onChange, idPrefix }: Props<T>) {
  const refs = useRef(new Map<T, HTMLButtonElement>());

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = tabs[(index + step + tabs.length) % tabs.length];
    onChange(next.id);
    refs.current.get(next.id)?.focus();
  }

  return (
    <div role="tablist" aria-label={label} className="flex h-9 items-end gap-5 border-b border-line">
      {tabs.map((tab, index) => {
        const active = tab.id === value;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            ref={(node) => {
              if (node) refs.current.set(tab.id, node);
              else refs.current.delete(tab.id);
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${tab.id}`}
            aria-selected={active}
            aria-controls={`${idPrefix}-panel-${tab.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "-mb-px h-full rounded-none border-0 border-b-2 bg-transparent px-1 text-[13px] hover:bg-transparent",
              active
                ? "border-primary font-semibold text-primary"
                : "border-transparent font-normal text-muted hover:text-fg",
            )}
          >
            {Icon && <Icon className="size-4" aria-hidden />}
            {tab.label}
            {tab.count !== undefined && (
              <span className="rounded bg-surface-muted px-1.5 font-mono text-[11px] text-muted">
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
