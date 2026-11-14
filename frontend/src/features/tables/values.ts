/** How each field type is shown, edited, filtered and sorted. Mirrors the backend rules. */

import type { Condition, FieldItem, FieldType, RecordItem, SelectOption } from "./schema";

/** Types whose value is made by the system: nobody edits them. */
const COMPUTED: ReadonlySet<FieldType> = new Set(["created_by", "created_time", "auto_number"]);
const SORTABLE: ReadonlySet<FieldType> = new Set([
  "text",
  "long_text",
  "url",
  "number",
  "auto_number",
  "date",
  "checkbox",
  "single_select",
  "status",
  "created_time",
]);

export function isComputed(field: FieldItem): boolean {
  return COMPUTED.has(field.type);
}

export function isSortable(field: FieldItem): boolean {
  return SORTABLE.has(field.type);
}

export function canEditField(field: FieldItem): boolean {
  return field.access === "edit" && !isComputed(field);
}

export function optionsOf(field: FieldItem): SelectOption[] {
  const options = field.config.options;
  if (!Array.isArray(options)) return [];
  return options.filter(
    (o): o is SelectOption =>
      typeof o === "object" &&
      o !== null &&
      typeof (o as SelectOption).id === "string" &&
      typeof (o as SelectOption).name === "string",
  );
}

export function optionName(field: FieldItem, id: unknown): string {
  return optionsOf(field).find((option) => option.id === id)?.name ?? "";
}

export function isMultiple(field: FieldItem): boolean {
  return field.config.multiple !== false;
}

export function linkTarget(field: FieldItem): string | null {
  return typeof field.config.table_id === "string" ? field.config.table_id : null;
}

/** The ids of people that a record names (user fields and created_by) for a set of fields. */
export function userIdsIn(fields: FieldItem[], records: RecordItem[]): string[] {
  const ids = new Set<string>();
  for (const record of records) {
    for (const field of fields) {
      const value = record.data[field.id];
      if (field.type === "user" && Array.isArray(value)) {
        for (const id of value) if (typeof id === "string") ids.add(id);
      } else if (field.type === "created_by" && typeof value === "string") {
        ids.add(value);
      }
    }
  }
  return [...ids];
}

export function displayValue(
  field: FieldItem,
  value: unknown,
  names: ReadonlyMap<string, string>,
): string {
  if (value === undefined || value === null) return "";
  switch (field.type) {
    case "checkbox":
      return value === true ? "✓" : "";
    case "single_select":
    case "status":
      return optionName(field, value);
    case "multi_select":
      return Array.isArray(value)
        ? value.map((id) => optionName(field, id)).filter(Boolean).join(", ")
        : "";
    case "user":
      return Array.isArray(value)
        ? value.map((id) => names.get(String(id)) ?? "…").join(", ")
        : "";
    case "created_by":
      return names.get(String(value)) ?? "…";
    case "link_record":
      return Array.isArray(value) && value.length > 0 ? `${value.length} linked` : "";
    case "created_time":
    case "date": {
      const text = String(value);
      // Dates are stored in UTC. Date-only values are shown as they are.
      return text.length > 10 ? new Date(text).toLocaleString() : text;
    }
    default:
      return String(value);
  }
}

// --- editing ---

/** What an input holds while somebody types: strings for text boxes, arrays for lists. */
export type Draft = string | boolean | string[];

export function draftFromValue(field: FieldItem, value: unknown): Draft {
  switch (field.type) {
    case "checkbox":
      return value === true;
    case "multi_select":
    case "user":
    case "link_record":
      return Array.isArray(value) ? value.map(String) : [];
    case "date": {
      const text = typeof value === "string" ? value : "";
      // A date-time input wants "YYYY-MM-DDTHH:MM" (local); a date input "YYYY-MM-DD".
      if (field.config.include_time === true && text) return toLocalInput(text);
      return text;
    }
    default:
      return value === undefined || value === null ? "" : String(value);
  }
}

/**
 * What a date column set to "created" holds for a record made now, by the clock of this computer
 * (so somebody in Vietnam at 22:00 gets their own day): "YYYY-MM-DD", or a UTC moment when the
 * column has a time. Null for every other column.
 */
export function createdDateValue(field: FieldItem, now: Date = new Date()): string | null {
  if (field.type !== "date" || field.config.fill !== "created") return null;
  if (field.config.include_time === true) return now.toISOString();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The start of a form for a new record: an automatic date is already there (and can be changed). */
export function newRecordDraft(field: FieldItem): Draft {
  return draftFromValue(field, createdDateValue(field) ?? undefined);
}

function toLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export type Parsed = { ok: true; value: unknown } | { ok: false; error: string };

/** The value to send for a draft: `null` clears the cell. */
export function parseDraft(field: FieldItem, draft: Draft): Parsed {
  switch (field.type) {
    case "checkbox":
      return { ok: true, value: draft === true };
    case "multi_select":
    case "user":
    case "link_record":
      return { ok: true, value: Array.isArray(draft) ? draft : [] };
    case "number": {
      const text = String(draft).trim();
      if (text === "") return { ok: true, value: null };
      const number = Number(text);
      return Number.isFinite(number)
        ? { ok: true, value: number }
        : { ok: false, error: "Must be a number." };
    }
    case "date": {
      const text = String(draft).trim();
      if (text === "") return { ok: true, value: null };
      if (field.config.include_time === true) {
        const date = new Date(text);
        return Number.isNaN(date.getTime())
          ? { ok: false, error: "Must be a date and time." }
          : { ok: true, value: date.toISOString() };
      }
      return { ok: true, value: text };
    }
    case "single_select":
    case "status":
      return { ok: true, value: draft === "" ? null : String(draft) };
    default: {
      const text = String(draft);
      return { ok: true, value: text === "" ? null : text };
    }
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** An empty cell, an empty list and an unchecked box that was never set all mean "nothing". */
function isNothing(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    value === false ||
    (Array.isArray(value) && value.length === 0)
  );
}

/**
 * The cells that changed between a record (null for a new one) and the drafts, ready to send.
 * Also returns the drafts that cannot be understood, keyed by field id.
 */
export function changesFor(
  fields: FieldItem[],
  record: RecordItem | null,
  drafts: Record<string, Draft>,
): { changes: Record<string, unknown>; errors: Record<string, string> } {
  const changes: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const field of fields) {
    if (!canEditField(field) || !(field.id in drafts)) continue;
    const parsed = parseDraft(field, drafts[field.id]);
    if (!parsed.ok) {
      errors[field.id] = parsed.error;
      continue;
    }
    const before = record?.data[field.id];
    if (isNothing(parsed.value) && isNothing(before)) continue;
    if (record === null || !sameValue(parsed.value, before)) changes[field.id] = parsed.value;
  }
  return { changes, errors };
}

// --- filtering ---

export type OperatorChoice = { op: string; label: string; needsValue: boolean };

const IS_EMPTY: OperatorChoice[] = [
  { op: "is_empty", label: "is empty", needsValue: false },
  { op: "is_not_empty", label: "is not empty", needsValue: false },
];
const COMPARE: OperatorChoice[] = [
  { op: "eq", label: "is", needsValue: true },
  { op: "neq", label: "is not", needsValue: true },
  { op: "gt", label: "is after / greater than", needsValue: true },
  { op: "gte", label: "is at or after / at least", needsValue: true },
  { op: "lt", label: "is before / less than", needsValue: true },
  { op: "lte", label: "is at or before / at most", needsValue: true },
];

export function operatorsFor(field: FieldItem): OperatorChoice[] {
  switch (field.type) {
    case "text":
    case "long_text":
    case "url":
      return [
        { op: "eq", label: "is", needsValue: true },
        { op: "neq", label: "is not", needsValue: true },
        { op: "contains", label: "contains", needsValue: true },
        ...IS_EMPTY,
      ];
    case "number":
    case "date":
      return [...COMPARE, ...IS_EMPTY];
    case "auto_number":
    case "created_time":
      return COMPARE;
    case "checkbox":
      return [{ op: "eq", label: "is", needsValue: true }];
    case "single_select":
    case "status":
      return [
        { op: "eq", label: "is", needsValue: true },
        { op: "neq", label: "is not", needsValue: true },
        ...IS_EMPTY,
      ];
    case "multi_select":
      return [{ op: "contains", label: "contains", needsValue: true }, ...IS_EMPTY];
    default:
      // People, links and the creator are compared by id, which is not something to type.
      return field.type === "created_by" ? [] : IS_EMPTY;
  }
}

/** Turns what was typed in the filter bar into the value the API expects. */
export function conditionValue(field: FieldItem, text: string): unknown {
  if (field.type === "checkbox") return text === "true";
  if (field.type === "number" || field.type === "auto_number") return Number(text);
  return text;
}

export function describeCondition(fields: FieldItem[], condition: Condition): string {
  const field = fields.find((f) => f.id === condition.field);
  if (!field) return "Unknown column";
  const op = operatorsFor(field).find((o) => o.op === condition.op);
  let value = "";
  if (op?.needsValue) {
    if (field.type === "single_select" || field.type === "status" || field.type === "multi_select") {
      value = optionName(field, condition.value);
    } else {
      value = String(condition.value);
    }
  }
  return [field.name, op?.label ?? condition.op, value].filter(Boolean).join(" ");
}
