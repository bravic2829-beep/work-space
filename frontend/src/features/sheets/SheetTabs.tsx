"use client";

import { ChevronDown, List, Pin, PinOff, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Avatar, Button } from "@/components/ui";
import { cn } from "@/lib/cn";

import type { SheetItem } from "./schema";

export const ALL_TASKS = "all";

type Props = {
  sheets: SheetItem[];
  /** Whether the "All tasks" tab is offered (the person sees every task of the table). */
  showAll: boolean;
  /** The id of the open sheet, or ALL_TASKS. */
  active: string;
  onSelect: (id: string) => void;
  /** Present when the person may make sheets: shows "+ Create sheet". */
  onCreate?: () => void;
  /** The sheets the person pinned: shown first, with a pin. */
  pinned?: ReadonlySet<string>;
  onTogglePin?: (id: string) => void;
  /** More buttons for the open sheet (Share, Add task), kept next to "Create sheet". */
  actions?: React.ReactNode;
};

const TAB =
  "flex h-10 shrink-0 items-center gap-2 border-0 border-b-2 border-transparent bg-transparent px-3.5 text-[13px] font-medium whitespace-nowrap text-muted hover:bg-transparent hover:text-fg";

/**
 * The strip of sheets: "All tasks" (when allowed) and one tab per sheet the person may open.
 * It scrolls sideways when there are many, and "Sheets" opens a searchable list to jump to one.
 */
export function SheetTabs({
  sheets,
  showAll,
  active,
  onSelect,
  onCreate,
  pinned = new Set<string>(),
  onTogglePin,
  actions,
}: Props) {
  return (
    <div className="flex items-end border-b border-line">
      <div
        role="tablist"
        aria-label="Sheets"
        className="flex min-w-0 flex-1 overflow-x-auto [scrollbar-width:thin]"
      >
        {showAll && (
          <button
            type="button"
            role="tab"
            aria-selected={active === ALL_TASKS}
            className={cn(TAB, active === ALL_TASKS && "border-primary font-semibold text-primary")}
            onClick={() => onSelect(ALL_TASKS)}
          >
            All tasks
          </button>
        )}
        {sheets.map((sheet) => (
          <button
            key={sheet.id}
            type="button"
            role="tab"
            aria-selected={active === sheet.id}
            title={sheet.name}
            className={cn(TAB, active === sheet.id && "border-primary font-semibold text-primary")}
            onClick={() => onSelect(sheet.id)}
          >
            <Avatar name={sheet.owner.full_name} className="size-5 text-[10px]" />
            <span className="max-w-44 truncate">{sheet.name}</span>
            {pinned.has(sheet.id) && <Pin className="size-3 text-muted" aria-label="Pinned" />}
          </button>
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-1 border-l border-line py-1 pl-2">
        <SheetList
          sheets={sheets}
          active={active}
          onSelect={onSelect}
          pinned={pinned}
          onTogglePin={onTogglePin}
        />
        {onCreate && (
          <Button size="sm" variant="ghost" icon={Plus} onClick={onCreate} className="text-primary">
            Create sheet
          </Button>
        )}
        {actions}
      </div>
    </div>
  );
}

/** "Sheets (24)": a searchable list, for when the tabs do not all fit. */
function SheetList({
  sheets,
  active,
  onSelect,
  pinned,
  onTogglePin,
}: {
  sheets: SheetItem[];
  active: string;
  onSelect: (id: string) => void;
  pinned: ReadonlySet<string>;
  onTogglePin?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const found = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return sheets;
    return sheets.filter(
      (sheet) =>
        sheet.name.toLowerCase().includes(needle) ||
        sheet.owner.employee_code.toLowerCase().includes(needle),
    );
  }, [sheets, query]);

  return (
    <div ref={root} className="relative">
      <Button
        size="sm"
        variant="ghost"
        icon={List}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Sheets ({sheets.length})
        <ChevronDown className="size-3.5" aria-hidden />
      </Button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-72 rounded-lg border border-line bg-surface p-2 shadow-lg">
          <label className="mb-2 flex items-center gap-2 rounded-md border border-line-strong px-2">
            <Search className="size-4 text-muted" aria-hidden />
            <input
              autoFocus
              aria-label="Find a sheet"
              placeholder="Find a sheet"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="min-w-0 flex-1 border-0 bg-transparent px-0 py-1.5 outline-none"
            />
          </label>
          <ul role="listbox" aria-label="All sheets" className="m-0 max-h-64 list-none overflow-y-auto p-0">
            {found.map((sheet) => (
              <li
                key={sheet.id}
                role="option"
                aria-selected={sheet.id === active}
                className="flex items-center gap-1"
              >
                <button
                  type="button"
                  className={cn(
                    "w-full justify-start gap-2 border-0 bg-transparent px-2 py-1.5 text-left font-normal hover:bg-surface-muted",
                    sheet.id === active && "bg-primary-soft font-semibold text-primary",
                  )}
                  onClick={() => {
                    onSelect(sheet.id);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <Avatar name={sheet.owner.full_name} className="size-5 text-[10px]" />
                  <span className="min-w-0 flex-1 truncate">{sheet.name}</span>
                  <span className="font-mono text-[11px] text-muted">{sheet.owner.employee_code}</span>
                </button>
                {onTogglePin && (
                  <button
                    type="button"
                    aria-label={pinned.has(sheet.id) ? `Unpin ${sheet.name}` : `Pin ${sheet.name}`}
                    aria-pressed={pinned.has(sheet.id)}
                    title={pinned.has(sheet.id) ? "Unpin" : "Pin to the front"}
                    className={cn(
                      "size-7 shrink-0 border-0 bg-transparent p-0 hover:bg-surface-muted",
                      pinned.has(sheet.id) ? "text-primary" : "text-muted",
                    )}
                    onClick={() => onTogglePin(sheet.id)}
                  >
                    {pinned.has(sheet.id) ? (
                      <PinOff className="size-3.5" aria-hidden />
                    ) : (
                      <Pin className="size-3.5" aria-hidden />
                    )}
                  </button>
                )}
              </li>
            ))}
            {found.length === 0 && (
              <li className="px-2 py-2 text-[13px] text-muted">No sheet matches “{query}”.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
