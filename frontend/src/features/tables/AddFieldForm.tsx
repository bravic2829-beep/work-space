"use client";

import { useEffect, useState } from "react";

import { Alert, Button, FormField, Input, Select, Textarea } from "@/components/ui";

import { createField, listTables } from "./api";
import { PALETTE } from "./colors";
import { FieldSettings } from "./FieldSettings";
import { EMPTY_SETTINGS, type Settings } from "./columnRules";
import { OptionBadge } from "./OptionBadge";
import { FIELD_TYPES, type FieldItem, type FieldType, type TableSummary } from "./schema";
import { errorMessage } from "@/lib/api/errors";

export const LABELS: Record<FieldType, string> = {
  text: "Text",
  long_text: "Long text",
  number: "Number",
  date: "Date",
  checkbox: "Checkbox",
  select: "Choice list",
  status: "Status",
  user: "People",
  link_record: "Link to records",
  created_by: "Created by",
  created_time: "Created time",
  auto_number: "Auto number",
  attachment: "Files",
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

/** Adds a column. Choice fields take their options one per line, and get a color each. */
export function AddFieldForm({ tableId, baseId, existing = [], onCreated }: Props) {
  const [name, setName] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const [options, setOptions] = useState("");
  const [settings, setSettings] = useState<Settings>(EMPTY_SETTINGS);
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
    if (type === "select" || type === "status") {
      // A status field without options gets the default states from the server.
      const base =
        type === "status" && optionLines.length === 0
          ? {}
          : { options: optionLines.map((line) => ({ name: line })) };
      return type === "select" ? { ...base, multiple: settings.config.multiple === true } : base;
    }
    if (type === "link_record") return { table_id: target };
    return settings.config;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const description = settings.description.trim();
      const field = await createField(tableId, {
        name: name.trim(),
        type,
        config: configFor(),
        ...(role ? { semantic: role } : {}),
        ...(description ? { description } : {}),
        ...(settings.unique ? { unique: true } : {}),
        ...(settings.default !== null ? { default: settings.default } : {}),
      });
      setName("");
      setRole("");
      setOptions("");
      setSettings(EMPTY_SETTINGS);
      onCreated(field);
    } catch (caught) {
      setError(errorMessage(caught, "Could not add the field."));
    } finally {
      setSaving(false);
    }
  }

  const needsOptions = type === "select" || type === "status";
  const hasSettings = type !== "link_record" && type !== "status" && !isSystem(type);
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
            setSettings(EMPTY_SETTINGS);
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
        <FormField label="Role of this column" hint={ROLE_HINTS[type]}>
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
              ? "Leave empty for To do, In progress, In review, Done, Paused, Blocked."
              : "Press Enter to start a new option. Each one gets a color you can change later."
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
            <OptionBadge
              key={`${line}-${index}`}
              name={line}
              color={PALETTE[index % PALETTE.length].hex}
            />
          ))}
        </div>
      )}
      {hasSettings && <FieldSettings type={type} value={settings} onChange={setSettings} />}
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

/** Columns the system fills in: nothing to set up. */
function isSystem(type: FieldType): boolean {
  return type === "created_by" || type === "created_time" || type === "auto_number" || type === "timer";
}
