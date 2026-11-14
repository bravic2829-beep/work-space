"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown, FileSearch } from "lucide-react";

import { Badge, Button, DataTable, EmptyState } from "@/components/ui";

import type { FieldItem, RecordItem, SortColumn } from "./schema";
import { StatusBadge } from "./StatusBadge";
import { displayValue, isSortable, optionsOf } from "./values";

type Props = {
  fields: FieldItem[];
  records: RecordItem[];
  names: ReadonlyMap<string, string>;
  sort: SortColumn[];
  selectedId: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  onSort: (field: FieldItem) => void;
  onSelect: (record: RecordItem) => void;
  onLoadMore: () => void;
};

function isWebLink(text: string): boolean {
  return /^https?:\/\//i.test(text);
}

/** A choice shown as a small label; a status takes its colour from the kind of the option. */
function Choice({ field, value }: { field: FieldItem; value: unknown }) {
  const ids = Array.isArray(value) ? value : [value];
  const options = optionsOf(field);
  return (
    <span className="inline-flex items-center gap-1">
      {ids.map((id) => {
        const option = options.find((o) => o.id === id);
        if (!option) return null;
        return field.type === "status" && option.kind ? (
          <StatusBadge key={option.id} name={option.name} kind={option.kind} />
        ) : (
          <Badge key={option.id}>{option.name}</Badge>
        );
      })}
    </span>
  );
}

/** The table view: one column per visible field, one row per record, dense like a spreadsheet. */
export function RecordGrid({
  fields,
  records,
  names,
  sort,
  selectedId,
  hasMore,
  loadingMore,
  onSort,
  onSelect,
  onLoadMore,
}: Props) {
  function ariaSort(field: FieldItem): "ascending" | "descending" | "none" | undefined {
    if (!isSortable(field)) return undefined;
    const column = sort.find((s) => s.field === field.id);
    if (!column) return "none";
    return column.direction === "asc" ? "ascending" : "descending";
  }

  if (records.length === 0) {
    return (
      <EmptyState icon={FileSearch} title="No records match.">
        Change the filter, or add a record with “New record”.
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <DataTable dense aria-label="Records" className="[&_td]:max-w-80 [&_td]:truncate">
        <thead>
          <tr>
            {fields.map((field) => {
              const direction = sort.find((s) => s.field === field.id)?.direction;
              const Arrow = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ChevronsUpDown;
              return (
                <th key={field.id} scope="col" aria-sort={ariaSort(field)}>
                  {isSortable(field) ? (
                    <button
                      type="button"
                      className="h-full gap-1 border-0 bg-transparent p-0 text-xs font-semibold tracking-wide text-muted uppercase hover:bg-transparent hover:text-fg"
                      onClick={() => onSort(field)}
                      aria-label={`Sort by ${field.name}`}
                    >
                      {field.name}
                      <Arrow
                        className={direction ? "size-3 text-primary" : "size-3 opacity-40"}
                        aria-hidden
                      />
                    </button>
                  ) : (
                    field.name
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {records.map((record) => {
            const selected = record.id === selectedId;
            return (
              <tr
                key={record.id}
                aria-selected={selected}
                className={selected ? "bg-primary-soft" : undefined}
              >
                {fields.map((field, index) => {
                  const value = record.data[field.id];
                  const text = displayValue(field, value, names);
                  return (
                    <td key={field.id}>
                      {index === 0 ? (
                        <button
                          type="button"
                          className="h-auto max-w-full justify-start border-0 bg-transparent p-0 font-semibold text-primary hover:bg-transparent hover:underline"
                          onClick={() => onSelect(record)}
                          aria-label={`Open record ${text || "(untitled)"}`}
                        >
                          <span className="truncate">{text || "(untitled)"}</span>
                        </button>
                      ) : (field.type === "status" || field.type === "single_select" || field.type === "multi_select") &&
                        text ? (
                        <Choice field={field} value={value} />
                      ) : field.type === "url" && isWebLink(text) ? (
                        <a href={text} target="_blank" rel="noopener noreferrer">
                          {text}
                        </a>
                      ) : field.type === "number" || field.type === "auto_number" ? (
                        <span className="block text-right font-mono text-xs">{text}</span>
                      ) : (
                        text
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </DataTable>
      <div className="flex items-center justify-between text-xs text-muted">
        <span className="font-mono">
          {records.length}
          {hasMore ? "+" : ""} {records.length === 1 && !hasMore ? "record" : "records"}
        </span>
        {hasMore && (
          <Button size="sm" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        )}
      </div>
    </div>
  );
}
