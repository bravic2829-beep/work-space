"use client";

import { useEffect, useState } from "react";

import { Alert, Button, Checkbox, FormField, Input, Select, Textarea } from "@/components/ui";
import { ApiError } from "@/lib/api/client";

import { createField, listTables } from "./api";
import { FIELD_TYPES, type FieldItem, type FieldType, type TableSummary } from "./schema";

export const LABELS: Record<FieldType, string> = {
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
  timer: "Timer (started, finished, time)",
};

type Props = {
  tableId: string;
  baseId: string;
  /** The columns the table already has: a role can be given to one column only. */
  existing?: FieldItem[];
  onCreated: (field: FieldItem) => void;
};

/**
 * The roles a column can take. Without one it is only a column: nobody is notified, the task
 * does not appear in "My tasks", and the people named in it cannot open the record.
 */
export const ROLES: Partial<Record<FieldType, { value: string; label: string }[]>> = {
  user: [
    {
      value: "assignee",
      label: "Assignee: is notified, sees the task in My tasks, can open it",
    },
    { value: "follower", label: "Follower: can open the task" },
  ],
  status: [{ value: "status", label: "Status of the task (review and Done use it)" }],
  date: [{ value: "due_date", label: "Due date (used by Today's tasks)" }],
};

/** What the role of a column does, for the type being added. */
const ROLE_HINTS: Partial<Record<FieldType, string>> = {
  user: "Choose Assignee to give tasks to people. Without a role this is just a column.",
  status: "Choose Status so review and Done know which column holds the state of the task.",
  date: "Choose Due date so the task shows in Today's tasks when it is due. Without a role this is just a date.",
};

/** Adds a column. Choice fields take their options one per line. */
export function AddFieldForm({ tableId, baseId, existing = [], onCreated }: Props) {
  const [name, setName] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const [options, setOptions] = useState("");
  const [precision, setPrecision] = useState("0");
  const [includeTime, setIncludeTime] = useState(false);
  const [fill, setFill] = useState<"manual" | "created">("manual");
  const [role, setRole] = useState("");
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

  const optionLines = options
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  function configFor(): Record<string, unknown> {
    if (type === "single_select" || type === "multi_select" || type === "status") {
      const lines = optionLines;
      // A status field without options gets the default four states from the server.
      return type === "status" && lines.length === 0
        ? {}
        : { options: lines.map((line) => ({ name: line })) };
    }
    if (type === "number") return { precision: Number(precision) };
    if (type === "date") {
      return { include_time: includeTime, ...(fill === "created" ? { fill } : {}) };
    }
    if (type === "link_record") return { table_id: target };
    return {};
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const field = await createField(tableId, {
        name: name.trim(),
        type,
        config: configFor(),
        ...(role ? { semantic: role } : {}),
      });
      setName("");
      setRole("");
      setFill("manual");
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
    <form onSubmit={(event) => void submit(event)} aria-label="Add a column" className="grid gap-4">
      <FormField label="Column name">
        <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
      </FormField>
      <FormField label="Type">
        <Select
          value={type}
          onChange={(e) => {
            setType(e.target.value as FieldType);
            setRole("");
            setFill("manual");
          }}
        >
          {FIELD_TYPES.map((t) => (
            <option key={t} value={t}>
              {LABELS[t]}
            </option>
          ))}
        </Select>
      </FormField>
      {ROLES[type] && (
        <FormField
          label="Role of this column"
          hint={ROLE_HINTS[type]}
        >
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">No role</option>
            {ROLES[type]?.map((item) => {
              const taken = existing.some((f) => f.semantic === item.value);
              return (
                <option key={item.value} value={item.value} disabled={taken}>
                  {item.label}
                  {taken ? " (the table already has one)" : ""}
                </option>
              );
            })}
          </Select>
        </FormField>
      )}
      {needsOptions && (
        <FormField
          label="Options (one per line)"
          hint={
            type === "status"
              ? "Leave empty for To do, In progress, In review, Done."
              : "Press Enter to start a new option."
          }
        >
          <Textarea
            rows={4}
            value={options}
            placeholder={"Low\nMedium\nHigh"}
            onChange={(e) => setOptions(e.target.value)}
          />
        </FormField>
      )}
      {needsOptions && optionLines.length > 0 && (
        <div aria-label="Preview of the options" className="flex flex-wrap gap-1.5">
          {optionLines.map((line, index) => (
            <span
              key={`${line}-${index}`}
              className="rounded-full border border-line-strong bg-surface px-3 py-1 text-sm font-medium"
            >
              {line}
            </span>
          ))}
        </div>
      )}
      {type === "number" && (
        <FormField label="Decimal places">
          <Input
            type="number"
            min={0}
            max={10}
            value={precision}
            onChange={(e) => setPrecision(e.target.value)}
          />
        </FormField>
      )}
      {type === "date" && (
        <FormField
          label="How is the date set?"
          hint={
            fill === "created"
              ? "The day the record is made is filled in for you. It can still be changed."
              : "Whoever edits the record picks the date."
          }
        >
          <Select value={fill} onChange={(e) => setFill(e.target.value as "manual" | "created")}>
            <option value="manual">Pick a date</option>
            <option value="created">Filled automatically when the record is created</option>
          </Select>
        </FormField>
      )}
      {type === "date" && (
        <Checkbox
          label="Include the time"
          checked={includeTime}
          onChange={(e) => setIncludeTime(e.target.checked)}
        />
      )}
      {type === "link_record" && (
        <FormField label="Link to table">
          <Select value={target} onChange={(e) => setTarget(e.target.value)} required>
            <option value="">Choose a table…</option>
            {tables.map((table) => (
              <option key={table.id} value={table.id}>
                {table.name}
              </option>
            ))}
          </Select>
        </FormField>
      )}
      {error && <Alert>{error}</Alert>}
      <div>
        <Button type="submit" variant="primary" loading={saving} disabled={name.trim() === ""}>
          {saving ? "Adding…" : "Add column"}
        </Button>
      </div>
    </form>
  );
}
