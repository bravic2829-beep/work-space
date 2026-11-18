import type { FieldItem, Group, GroupBucket, TotalFn } from "./schema";

/** The column types the records can be grouped by (the same list as the backend). */
const GROUPABLE: ReadonlySet<string> = new Set([
  "text",
  "long_text",
  "url",
  "number",
  "auto_number",
  "single_select",
  "status",
  "multi_select",
  "user",
  "created_by",
  "link_record",
  "date",
  "created_time",
  "checkbox",
]);
const DATED: ReadonlySet<string> = new Set(["date", "created_time"]);
const NUMBERS: ReadonlySet<string> = new Set(["number", "auto_number"]);

export function groupableFields(fields: FieldItem[]): FieldItem[] {
  return fields.filter((field) => GROUPABLE.has(field.type));
}

export function numberFields(fields: FieldItem[]): FieldItem[] {
  return fields.filter((field) => NUMBERS.has(field.type));
}

export function isDated(field: FieldItem | undefined): boolean {
  return field !== undefined && DATED.has(field.type);
}

export const FN_LABELS: Record<TotalFn, string> = {
  sum: "Sum",
  avg: "Average",
  min: "Smallest",
  max: "Largest",
};

export const BUCKET_LABELS: Record<GroupBucket, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
};

/** The key of a group in a map: a group with no value has a null key. */
export function groupKey(group: Group): string {
  return group.key ?? "∅";
}

/** A total as the person reads it: the precision of the column, two decimals for an average. */
export function formatTotal(value: number, field: FieldItem | undefined, fn: TotalFn): string {
  const precision = typeof field?.config.precision === "number" ? field.config.precision : 0;
  const digits = fn === "avg" ? Math.max(precision, 2) : precision;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value);
}

/**
 * What the header of a group says under each column: "Sum 190", "Average 95". A group with no value
 * in the column has nothing to say (no dash that could be taken for a zero).
 */
export function totalTexts(group: Group, fields: FieldItem[]): Map<string, string[]> {
  const texts = new Map<string, string[]>();
  for (const total of group.totals) {
    if (total.value === null) continue;
    const field = fields.find((f) => f.id === total.field_id);
    const line = `${FN_LABELS[total.fn]} ${formatTotal(total.value, field, total.fn)}`;
    texts.set(total.field_id, [...(texts.get(total.field_id) ?? []), line]);
  }
  return texts;
}
