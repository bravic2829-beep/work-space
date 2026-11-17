"use client";

import { ChevronDown, Columns3, Eye, EyeOff } from "lucide-react";

import { Button, Popover, PopoverContent, PopoverTrigger } from "@/components/ui";

import type { FieldItem } from "./schema";

type Props = {
  fields: FieldItem[];
  /** The ids of the columns that are hidden. */
  hidden: string[];
  onChange: (hidden: string[]) => void;
  /** The columns that have no value in any loaded row. */
  emptyIds: string[];
  hideEmpty: boolean;
  onHideEmptyChange: (hide: boolean) => void;
};

const LABEL = "Show or hide columns";

/** "Columns": click to choose which columns are shown. */
export function ColumnsMenu({
  fields,
  hidden,
  onChange,
  emptyIds,
  hideEmpty,
  onHideEmptyChange,
}: Props) {
  const gone = new Set([...hidden, ...(hideEmpty ? emptyIds : [])]);
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button size="sm" icon={Columns3} aria-label={LABEL}>
            Columns
            {gone.size > 0 && (
              <span className="font-normal text-muted">
                · {fields.length - gone.size}/{fields.length}
              </span>
            )}
            <ChevronDown className="size-3.5" aria-hidden />
          </Button>
        }
      />

      <PopoverContent align="end">
        <div className="flex items-center justify-between px-2 py-1 text-[11px] font-medium tracking-wider text-muted uppercase">
          Columns
          {hidden.length > 0 && (
            <button
              type="button"
              className="cursor-pointer border-0 bg-transparent p-0 text-[11px] font-medium tracking-normal text-primary normal-case hover:underline"
              onClick={() => onChange([])}
            >
              Show all
            </button>
          )}
        </div>
        <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[13px] hover:bg-surface-muted has-focus-visible:outline-2 has-focus-visible:outline-primary">
          <input
            type="checkbox"
            checked={hideEmpty}
            onChange={(event) => onHideEmptyChange(event.target.checked)}
          />
          <span className="flex-1">Hide empty columns</span>
          <span className="font-mono text-[11px] text-muted">{emptyIds.length}</span>
        </label>
        <ul className="m-0 max-h-72 list-none overflow-y-auto p-0">
          {fields.map((field) => {
            const visible = !hidden.includes(field.id);
            return (
              <li key={field.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[13px] hover:bg-surface-muted has-focus-visible:outline-2 has-focus-visible:outline-primary">
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={visible}
                    onChange={(event) =>
                      onChange(
                        event.target.checked
                          ? hidden.filter((id) => id !== field.id)
                          : [...hidden, field.id],
                      )
                    }
                  />
                  {visible ? (
                    <Eye className="size-4 shrink-0 text-primary" aria-hidden />
                  ) : (
                    <EyeOff className="size-4 shrink-0 text-muted" aria-hidden />
                  )}
                  <span className={visible ? "truncate" : "truncate text-muted line-through"}>
                    {field.name}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
