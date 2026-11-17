"use client";

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  FileSearch,
  Trash2,
} from "lucide-react";

import { Fragment } from "react";

import { Avatar, Badge, Button, DataTable, EmptyState, InlineConfirm } from "@/components/ui";
import { dueInfo, localToday, type DueTone } from "@/features/mytasks/schema";
import { cn } from "@/lib/cn";

import type { FieldItem, RecordItem, SortColumn } from "./schema";
import { StatusBadge } from "./StatusBadge";
import { statusKind } from "./taskWorkflow";
import { describeTimer, isTimerField, timerHeadings } from "./timer";
import { TimerCell } from "./TimerCell";
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
  /** Only the person who created a record may delete it, so only they get a Delete button. */
  currentUserId?: string;
  onDelete?: (record: RecordItem) => void;
  /** An organization admin may press Start and Stop on any task. */
  isAdmin?: boolean;
  /** A row changed on the server (a timer was started or stopped): show the new version. */
  onRecordChanged?: (record: RecordItem) => void;
  /** An organization admin may delete any row, not only the ones they created. */
  canDeleteAny?: boolean;
};

/** What an empty cell shows, so a row reads as complete. */
const EMPTY = (
  <span aria-hidden className="text-line-strong">
    —
  </span>
);

const DUE_TONE: Record<DueTone, string> = {
  overdue: "font-semibold text-danger",
  today: "font-semibold text-primary",
  normal: "",
};

/** A due date in words ("Today", "Overdue 2 days") with a colour and, when late, an icon. */
function DueCell({ text, done }: { text: string; done: boolean }) {
  const info = done ? null : dueInfo(text, localToday());
  if (!info || info.tone === "normal") return <>{text}</>;
  return (
    <span className={cn("inline-flex items-center gap-1", DUE_TONE[info.tone])} title={text}>
      {info.tone === "overdue" && <AlertTriangle className="size-3.5" aria-hidden />}
      {info.label}
    </span>
  );
}

/** The people named in a user column, each with a round badge of their initials. */
function PeopleCell({ ids, names }: { ids: unknown[]; names: ReadonlyMap<string, string> }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      {ids
        .filter((id): id is string => typeof id === "string")
        .map((id) => {
          const label = names.get(id) ?? "…";
          return (
            <span key={id} className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <Avatar name={label} className="size-5 text-[10px]" />
              {label}
            </span>
          );
        })}
    </span>
  );
}

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
  currentUserId = "",
  onDelete,
  isAdmin = false,
  onRecordChanged,
  canDeleteAny = false,
}: Props) {
  const showActions = onDelete !== undefined && currentUserId !== "";
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
      <DataTable dense sticky aria-label="Records" className="[&_td]:max-w-80 [&_td]:truncate">
        <thead>
          <tr>
            {fields.map((field, index) => {
              if (isTimerField(field)) {
                return (
                  <th key={field.id} scope="col" className="whitespace-nowrap">
                    {timerHeadings(field, fields).time}
                  </th>
                );
              }
              const direction = sort.find((s) => s.field === field.id)?.direction;
              const Arrow = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ChevronsUpDown;
              return (
                <Fragment key={field.id}>
                  <th
                    scope="col"
                    aria-sort={ariaSort(field)}
                    className={index === 0 ? "min-w-64" : "whitespace-nowrap"}
                  >
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
                </Fragment>
              );
            })}
            {showActions && (
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {records.map((record) => {
            const selected = record.id === selectedId;
            return (
              <tr
                key={record.id}
                aria-selected={selected}
                className="group cursor-pointer"
                onClick={(event) => {
                  // A click on a button, link or field inside the row does its own thing.
                  if (!(event.target as HTMLElement).closest("button, a, input, select, textarea")) {
                    onSelect(record);
                  }
                }}
              >
                {fields.map((field, index) => {
                  const value = record.data[field.id];
                  const text = displayValue(field, value, names);
                  if (isTimerField(field)) {
                    // The time spent; when it started and finished is in the tooltip.
                    return (
                      <td
                        key={field.id}
                        className="min-w-44 whitespace-nowrap"
                        title={describeTimer(value) || undefined}
                      >
                        <TimerCell
                          fields={fields}
                          field={field}
                          record={record}
                          currentUserId={currentUserId}
                          isAdmin={isAdmin}
                          idle={EMPTY}
                          onChanged={(updated) => onRecordChanged?.(updated)}
                        />
                      </td>
                    );
                  }
                  return (
                    <Fragment key={field.id}>
                    <td className={index === 0 ? "min-w-64" : undefined}>
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
                      ) : field.semantic === "due_date" && field.type === "date" && text ? (
                        <DueCell text={text} done={statusKind(fields, record) === "done"} />
                      ) : field.type === "user" && Array.isArray(value) && value.length > 0 ? (
                        <PeopleCell ids={value} names={names} />
                      ) : field.type === "url" && isWebLink(text) ? (
                        <a href={text} target="_blank" rel="noopener noreferrer">
                          {text}
                        </a>
                      ) : field.type === "number" || field.type === "auto_number" ? (
                        <span className="block text-right font-mono text-xs">{text}</span>
                      ) : text ? (
                        text
                      ) : (
                        EMPTY
                      )}
                    </td>
                    </Fragment>
                  );
                })}
                {showActions && (
                  <td className="text-right whitespace-nowrap">
                    <span className="inline-flex items-center justify-end gap-1 transition-opacity max-md:opacity-100 md:opacity-0 md:focus-within:opacity-100 md:group-hover:opacity-100">
                      {onDelete && (canDeleteAny || record.created_by === currentUserId) && (
                        <InlineConfirm
                          label="Delete"
                          icon={Trash2}
                          prompt="Delete?"
                          confirmLabel="Yes, delete"
                          onConfirm={() => onDelete(record)}
                        />
                      )}
                    </span>
                  </td>
                )}
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
