"use client";

import { useEffect, useState } from "react";

import { getTable, listRecords } from "./api";
import type { FieldItem, RecordItem } from "./schema";
import { isMultiple, linkTarget } from "./values";

type Props = {
  field: FieldItem;
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
};

type Candidates =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; items: { id: string; label: string }[]; more: boolean };

/** Choose the records a link field points at, from the first records of the linked table. */
export function LinkPicker({ field, value, onChange, disabled }: Props) {
  const target = linkTarget(field);
  const multiple = isMultiple(field);
  const [state, setState] = useState<Candidates>({ kind: "loading" });

  useEffect(() => {
    if (!target) return;
    const controller = new AbortController();

    async function load(tableId: string) {
      try {
        const table = await getTable(tableId, controller.signal);
        const nameField = table.fields[0];
        const page = await listRecords(tableId, { filter: [], sort: [], limit: 100 }, controller.signal);
        const label = (record: RecordItem) => {
          const text = nameField ? record.data[nameField.id] : undefined;
          return typeof text === "string" && text !== "" ? text : "(untitled)";
        };
        setState({
          kind: "ready",
          items: page.items.map((record) => ({ id: record.id, label: label(record) })),
          more: page.next_cursor !== null,
        });
      } catch {
        if (!controller.signal.aborted) setState({ kind: "error" });
      }
    }

    void load(target);
    return () => controller.abort();
  }, [target]);

  if (!target) return <p>This link field is not set up.</p>;
  if (state.kind === "loading") return <p role="status">Loading records…</p>;
  if (state.kind === "error") return <p role="alert">Could not load the records to link to.</p>;

  function toggle(id: string, checked: boolean) {
    if (!multiple) onChange(checked ? [id] : []);
    else onChange(checked ? [...value, id] : value.filter((other) => other !== id));
  }

  const labels = new Map(state.items.map((item) => [item.id, item.label]));
  // Linked records that are not in the first 100 are still shown (and can be removed).
  const extra = value.filter((id) => !labels.has(id));

  return (
    <fieldset className="link-picker" disabled={disabled}>
      <legend className="visually-hidden">{field.name}</legend>
      {state.items.length === 0 && extra.length === 0 && <p>No records to link to yet.</p>}
      {[...state.items, ...extra.map((id) => ({ id, label: "Linked record" }))].map((item) => (
        <label key={item.id}>
          <input
            type={multiple ? "checkbox" : "radio"}
            name={`link-${field.id}`}
            checked={value.includes(item.id)}
            onChange={(event) => toggle(item.id, event.target.checked)}
          />{" "}
          {item.label}
        </label>
      ))}
      {state.more && <p>Only the first 100 records are listed.</p>}
    </fieldset>
  );
}
