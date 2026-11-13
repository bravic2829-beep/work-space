"use client";

import { useEffect, useState } from "react";

import { ApiError } from "@/lib/api/client";

import { createField, listTables } from "./api";
import { FIELD_TYPES, type FieldItem, type FieldType, type TableSummary } from "./schema";

const LABELS: Record<FieldType, string> = {
  text: "Text",
  long_text: "Long text",
  number: "Number",
  date: "Date",
  checkbox: "Checkbox",
  single_select: "Single choice",
  multi_select: "Multiple choice",
  status: "Status",
  user: "People",
  url: "Link (URL)",
  link_record: "Link to records",
  created_by: "Created by",
  created_time: "Created time",
  auto_number: "Auto number",
};

type Props = {
  tableId: string;
  baseId: string;
  onCreated: (field: FieldItem) => void;
};

/** Adds a column. Choice fields take their options one per line. */
export function AddFieldForm({ tableId, baseId, onCreated }: Props) {
  const [name, setName] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const [options, setOptions] = useState("");
  const [precision, setPrecision] = useState("0");
  const [includeTime, setIncludeTime] = useState(false);
  const [target, setTarget] = useState("");
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (type !== "link_record") return;
    const controller = new AbortController();
    listTables(baseId, controller.signal)
      .then(setTables)
      .catch(() => {
        if (!controller.signal.aborted) setError("Could not load the tables of this base.");
      });
    return () => controller.abort();
  }, [type, baseId]);

  function configFor(): Record<string, unknown> {
    if (type === "single_select" || type === "multi_select" || type === "status") {
      const lines = options
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      // A status field without options gets the default four states from the server.
      return type === "status" && lines.length === 0
        ? {}
        : { options: lines.map((line) => ({ name: line })) };
    }
    if (type === "number") return { precision: Number(precision) };
    if (type === "date") return { include_time: includeTime };
    if (type === "link_record") return { table_id: target };
    return {};
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const field = await createField(tableId, { name: name.trim(), type, config: configFor() });
      setName("");
      setOptions("");
      onCreated(field);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not add the field.");
    } finally {
      setSaving(false);
    }
  }

  const needsOptions = type === "single_select" || type === "multi_select" || type === "status";
  return (
    <form onSubmit={(event) => void submit(event)} aria-label="Add a column" className="stack">
      <label>
        Column name
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
      </label>
      <label>
        Type
        <select value={type} onChange={(e) => setType(e.target.value as FieldType)}>
          {FIELD_TYPES.map((t) => (
            <option key={t} value={t}>
              {LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      {needsOptions && (
        <label>
          Options (one per line)
          <textarea rows={4} value={options} onChange={(e) => setOptions(e.target.value)} />
        </label>
      )}
      {type === "number" && (
        <label>
          Decimal places
          <input
            type="number"
            min={0}
            max={10}
            value={precision}
            onChange={(e) => setPrecision(e.target.value)}
          />
        </label>
      )}
      {type === "date" && (
        <label>
          <input
            type="checkbox"
            checked={includeTime}
            onChange={(e) => setIncludeTime(e.target.checked)}
          />{" "}
          Include the time
        </label>
      )}
      {type === "link_record" && (
        <label>
          Link to table
          <select value={target} onChange={(e) => setTarget(e.target.value)} required>
            <option value="">Choose a table…</option>
            {tables.map((table) => (
              <option key={table.id} value={table.id}>
                {table.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={saving || name.trim() === ""}>
        {saving ? "Adding…" : "Add column"}
      </button>
    </form>
  );
}
