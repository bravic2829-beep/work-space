"use client";

import { Layers } from "lucide-react";

import { Button, Popover, PopoverContent, PopoverTrigger, Select } from "@/components/ui";

import {
  BUCKET_LABELS,
  FN_LABELS,
  groupableFields,
  isDated,
  numberFields,
} from "./groups";
import type { FieldItem, GroupBucket, TotalFn, ViewTotal } from "./schema";

type Props = {
  fields: FieldItem[];
  /** The column the rows are grouped by, or null. */
  groupBy: string | null;
  bucket: GroupBucket | null;
  totals: ViewTotal[];
  onGroupBy: (field: string | null) => void;
  onBucket: (bucket: GroupBucket) => void;
  /** One total per number column: null removes it. */
  onTotal: (field: string, fn: TotalFn | null) => void;
};

const HEADING =
  "px-2 pt-2 pb-1 text-[11px] font-medium tracking-wider text-muted uppercase first:pt-1";

/**
 * "Group": fold the rows under the values of a column (a status, a person, a month, the parent
 * task), with a total of a number column on each group header.
 */
export function GroupMenu({ fields, groupBy, bucket, totals, onGroupBy, onBucket, onTotal }: Props) {
  const groupable = groupableFields(fields);
  const active = groupBy ? fields.find((f) => f.id === groupBy) : undefined;
  const numbers = numberFields(fields);
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button size="sm" icon={Layers}>
            Group
            {active && <span className="font-normal text-muted">· {active.name}</span>}
          </Button>
        }
      />
      <PopoverContent>
        <div className="grid min-w-60 gap-1">
          <label className="grid gap-1 px-2 py-1 text-[13px] font-medium">
            Group by
            <Select
              className="h-8 py-0 text-[13px]"
              value={groupBy ?? ""}
              onChange={(event) => onGroupBy(event.target.value || null)}
            >
              <option value="">No grouping</option>
              {groupable.map((field) => (
                <option key={field.id} value={field.id}>
                  {field.name}
                </option>
              ))}
            </Select>
          </label>

          {active && isDated(active) && (
            <label className="grid gap-1 px-2 py-1 text-[13px] font-medium">
              Group dates by
              <Select
                className="h-8 py-0 text-[13px]"
                value={bucket ?? "month"}
                onChange={(event) => onBucket(event.target.value as GroupBucket)}
              >
                {(Object.keys(BUCKET_LABELS) as GroupBucket[]).map((value) => (
                  <option key={value} value={value}>
                    {BUCKET_LABELS[value]}
                  </option>
                ))}
              </Select>
            </label>
          )}

          {active && numbers.length > 0 && (
            <>
              <div className={HEADING}>Totals on each group</div>
              {numbers.map((field) => {
                const current = totals.find((t) => t.field === field.id)?.fn ?? "";
                return (
                  <label
                    key={field.id}
                    className="flex items-center justify-between gap-3 px-2 py-0.5 text-[13px]"
                  >
                    {field.name}
                    <Select
                      aria-label={`Total of ${field.name}`}
                      className="h-7 w-auto py-0 text-[13px]"
                      value={current}
                      onChange={(event) =>
                        onTotal(field.id, (event.target.value || null) as TotalFn | null)
                      }
                    >
                      <option value="">None</option>
                      {(Object.keys(FN_LABELS) as TotalFn[]).map((fn) => (
                        <option key={fn} value={fn}>
                          {FN_LABELS[fn]}
                        </option>
                      ))}
                    </Select>
                  </label>
                );
              })}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
