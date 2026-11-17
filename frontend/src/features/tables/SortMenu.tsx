"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { Button, Popover, PopoverContent, PopoverTrigger } from "@/components/ui";

import type { FieldItem, SortColumn } from "./schema";
import { isSortable } from "./values";

type Props = {
  fields: FieldItem[];
  sort: SortColumn[];
  /** Same cycle as clicking a column heading: ascending, descending, none. */
  onToggle: (field: FieldItem) => void;
};

/** "Sort": choose the column the rows are ordered by. The column headings do the same. */
export function SortMenu({ fields, sort, onToggle }: Props) {
  const sortable = fields.filter(isSortable);
  const active = sort[0];
  const activeField = active ? fields.find((f) => f.id === active.field) : undefined;
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button size="sm" icon={ArrowUpDown}>
            Sort
            {activeField && <span className="font-normal text-muted">· {activeField.name}</span>}
          </Button>
        }
      />
      <PopoverContent>
        <ul className="m-0 max-h-72 list-none overflow-y-auto p-0">
          {sortable.map((field) => {
            const direction = sort.find((s) => s.field === field.id)?.direction;
            return (
              <li key={field.id}>
                <button
                  type="button"
                  aria-pressed={direction !== undefined}
                  className="flex w-full justify-between rounded border-0 bg-transparent px-2 py-1 text-left text-[13px] font-normal hover:bg-surface-muted"
                  onClick={() => onToggle(field)}
                >
                  <span className={direction ? "font-semibold text-primary" : undefined}>
                    {field.name}
                  </span>
                  {direction === "asc" && (
                    <ArrowUp className="size-3.5 text-primary" aria-label="ascending" />
                  )}
                  {direction === "desc" && (
                    <ArrowDown className="size-3.5 text-primary" aria-label="descending" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
