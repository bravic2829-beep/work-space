/** What a column can be told to do, by type. Mirrors the descriptor table in backend `types.py`. */

import type { FieldItem, FieldType } from "./schema";

const REQUIRED: ReadonlySet<FieldType> = new Set([
  "text",
  "long_text",
  "number",
  "date",
  "select",
  "status",
  "user",
]);
const UNIQUE: ReadonlySet<FieldType> = new Set(["text", "number"]);
const DEFAULT: ReadonlySet<FieldType> = new Set([
  "text",
  "long_text",
  "number",
  "date",
  "checkbox",
  "select",
]);

/** False is a value, so a checkbox cannot be required; system made columns have no say either. */
export function canBeRequired(type: FieldType): boolean {
  return REQUIRED.has(type);
}

export function canBeUnique(type: FieldType): boolean {
  return UNIQUE.has(type);
}

export function canHaveDefault(type: FieldType): boolean {
  return DEFAULT.has(type);
}

/** What the settings form holds while somebody edits it. */
export type Settings = {
  config: Record<string, unknown>;
  description: string;
  unique: boolean;
  /** A preset value in the form the API takes, or null for none. */
  default: unknown;
};

export function settingsOf(field: FieldItem): Settings {
  return {
    config: field.config,
    description: field.description ?? "",
    unique: field.unique,
    default: field.default ?? null,
  };
}

export const EMPTY_SETTINGS: Settings = { config: {}, description: "", unique: false, default: null };

/** A config key set to a value, or taken away when the value is empty. */
export function withConfig(
  config: Record<string, unknown>,
  key: string,
  value: unknown,
): Record<string, unknown> {
  const next = { ...config };
  if (value === undefined || value === null || value === "" || Number.isNaN(value)) delete next[key];
  else next[key] = value;
  return next;
}

/** The text of a number box as a number, or undefined while it is empty or not a number. */
export function numberOrUndefined(text: string): number | undefined {
  if (text.trim() === "") return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

/** The types of one kind of file a column can be limited to, as the text of one input. */
export function acceptText(config: Record<string, unknown>): string {
  return Array.isArray(config.accept) ? config.accept.join(", ") : "";
}

export function acceptFromText(text: string): string[] | undefined {
  const list = text
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return list.length > 0 ? list : undefined;
}
