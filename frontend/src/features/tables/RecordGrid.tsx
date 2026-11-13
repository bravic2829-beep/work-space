"use client";

import type { FieldItem, RecordItem, SortColumn } from "./schema";
import { displayValue, isSortable } from "./values";

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

/** The table view: one column per visible field, one row per record. */
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

  return (
    <div className="grid-wrap">
      <table className="grid">
        <thead>
          <tr>
            {fields.map((field) => (
              <th key={field.id} scope="col" aria-sort={ariaSort(field)}>
                {isSortable(field) ? (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => onSort(field)}
                    aria-label={`Sort by ${field.name}`}
                  >
                    {field.name}
                    {sort.find((s) => s.field === field.id)?.direction === "asc" && " ▲"}
                    {sort.find((s) => s.field === field.id)?.direction === "desc" && " ▼"}
                  </button>
                ) : (
                  field.name
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr
              key={record.id}
              aria-selected={record.id === selectedId}
              className={record.id === selectedId ? "selected" : undefined}
            >
              {fields.map((field, index) => {
                const text = displayValue(field, record.data[field.id], names);
                return (
                  <td key={field.id}>
                    {index === 0 ? (
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => onSelect(record)}
                        aria-label={`Open record ${text || "(untitled)"}`}
                      >
                        {text || "(untitled)"}
                      </button>
                    ) : field.type === "url" && isWebLink(text) ? (
                      <a href={text} target="_blank" rel="noopener noreferrer">
                        {text}
                      </a>
                    ) : (
                      text
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {records.length === 0 && <p>No records match.</p>}
      {hasMore && (
        <button type="button" onClick={onLoadMore} disabled={loadingMore}>
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
