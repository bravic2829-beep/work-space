"use client";

import { useEffect, useRef, useState } from "react";

import { getRecord, getTable, listRecords } from "./api";
import type { FieldItem, RecordItem } from "./schema";
import { isMultiple, linkTarget } from "./values";

type Props = {
  field: FieldItem;
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
};

type Found = { id: string; label: string };

/** How many matches to offer. The person narrows them by typing more of the name. */
const RESULTS = 20;
const UNTITLED = "(untitled)";

/**
 * Choose the records a link field points at by searching their name (the first text column of
 * the linked table). Nothing is listed until the person types, so a table with thousands of
 * records is as easy to use as one with five. The records already linked show as chips.
 */
export function LinkPicker({ field, value, onChange, disabled }: Props) {
  const target = linkTarget(field);
  const multiple = isMultiple(field);
  const [nameField, setNameField] = useState<FieldItem | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [labels, setLabels] = useState<Map<string, string>>(new Map());
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Found[]>([]);
  const [searching, setSearching] = useState(false);
  // Ids whose name was already asked for, so a failed lookup is not repeated on every render.
  const asked = useRef(new Set<string>());

  const labelOf = (record: RecordItem, column: FieldItem | null | undefined) => {
    const text = column ? record.data[column.id] : undefined;
    return typeof text === "string" && text !== "" ? text : UNTITLED;
  };

  // The column that names the records of the linked table.
  useEffect(() => {
    if (!target) return;
    const controller = new AbortController();
    getTable(target, controller.signal)
      .then((table) => {
        setNameField(table.fields.find((f) => f.type === "text") ?? table.fields[0] ?? null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [target]);

  // The names of the records already linked.
  useEffect(() => {
    if (nameField === undefined) return;
    const missing = value.filter((id) => !labels.has(id) && !asked.current.has(id));
    if (missing.length === 0) return;
    const controller = new AbortController();
    missing.forEach((id) => asked.current.add(id));
    void Promise.all(
      missing.map((id) =>
        getRecord(id, controller.signal)
          .then((record): [string, string] => [id, labelOf(record, nameField)])
          .catch((): [string, string] | null => null),
      ),
    ).then((pairs) => {
      if (controller.signal.aborted) return;
      setLabels((current) => {
        const next = new Map(current);
        for (const pair of pairs) if (pair) next.set(pair[0], pair[1]);
        return next;
      });
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `labels` is read, not a trigger
  }, [value, nameField]);

  // The matches for what was typed.
  useEffect(() => {
    if (!target || disabled || nameField === undefined || query.trim() === "") return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const filter =
          nameField && nameField.type === "text"
            ? [{ field: nameField.id, op: "contains", value: query.trim() }]
            : [];
        const page = await listRecords(target, { filter, sort: [], limit: RESULTS }, controller.signal);
        if (controller.signal.aborted) return;
        const found = page.items.map((record) => ({ id: record.id, label: labelOf(record, nameField) }));
        setLabels((current) => {
          const next = new Map(current);
          for (const item of found) next.set(item.id, item.label);
          return next;
        });
        setResults(found);
      } catch {
        if (!controller.signal.aborted) setResults([]);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, target, disabled, nameField]);

  if (!target) return <p>This link field is not set up.</p>;
  if (failed) return <p role="alert">Could not load the records to link to.</p>;

  function add(item: Found) {
    onChange(multiple ? [...new Set([...value, item.id])] : [item.id]);
    setQuery("");
    setResults([]);
  }

  return (
    <div>
      <ul className="chips" aria-label={`${field.name}: linked`}>
        {value.map((id) => (
          <li key={id}>
            {labels.get(id) ?? "…"}
            {!disabled && (
              <button
                type="button"
                aria-label={`Remove ${labels.get(id) ?? "linked record"}`}
                onClick={() => onChange(value.filter((other) => other !== id))}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      {!disabled && (
        <>
          <input
            type="search"
            className="w-full"
            aria-label={`Find a record for ${field.name}`}
            placeholder="Type to find a record"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {searching && <span role="status"> Searching…</span>}
          {query.trim() !== "" && !searching && (
            <ul className="results" aria-label={`${field.name}: search results`}>
              {results
                .filter((item) => !value.includes(item.id))
                .map((item) => (
                  <li key={item.id}>
                    <button type="button" onClick={() => add(item)}>
                      Add {item.label}
                    </button>
                  </li>
                ))}
              {results.filter((item) => !value.includes(item.id)).length === 0 && (
                <li>
                  <span>No record found.</span>
                </li>
              )}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
