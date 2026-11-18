"use client";

import { useState } from "react";

import { Checkbox, FormField, Input, Select } from "@/components/ui";

import {
  acceptFromText,
  acceptText,
  canBeUnique,
  canHaveDefault,
  numberOrUndefined,
  withConfig,
  type Settings,
} from "./columnRules";
import type { FieldType, SelectOption } from "./schema";

type Props = {
  type: FieldType;
  value: Settings;
  onChange: (next: Settings) => void;
  /** The options of a select column, so that one can be preset. Unknown while a column is new. */
  options?: SelectOption[];
  disabled?: boolean;
  /** Prefix for the accessible names, for example the column's name. */
  label?: string;
};

/**
 * The settings of one column that depend on its type (format, limits, one or several choices,
 * files accepted) and the ones every column has (hint, unique, preset value). Used when a column
 * is added and when it is edited.
 */
export function FieldSettings({ type, value, onChange, options = [], disabled, label = "" }: Props) {
  const { config } = value;
  // What is typed in the "only these files" box, as typed: the list made from it would lose the
  // comma and the space the person has just written.
  const [acceptDraft, setAcceptDraft] = useState(() => acceptText(value.config));
  const setConfig = (key: string, next: unknown) =>
    onChange({ ...value, config: withConfig(config, key, next) });
  const name = (text: string) => (label ? `${text} of ${label}` : text);
  const text = (key: string) => (config[key] === undefined ? "" : String(config[key]));

  return (
    <div className="grid gap-3">
      <FormField label="Hint" hint="Shown next to the column name.">
        <Input
          aria-label={name("Hint")}
          value={value.description}
          maxLength={500}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, description: event.target.value })}
        />
      </FormField>

      {type === "text" && (
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Format">
            <Select
              aria-label={name("Format")}
              value={typeof config.format === "string" ? config.format : "plain"}
              disabled={disabled}
              onChange={(event) =>
                setConfig("format", event.target.value === "plain" ? undefined : event.target.value)
              }
            >
              <option value="plain">Plain text</option>
              <option value="url">Link (URL)</option>
              <option value="email">Email</option>
              <option value="phone">Phone</option>
            </Select>
          </FormField>
          <FormField label="Longest text (characters)">
            <Input
              type="number"
              min={1}
              max={2048}
              aria-label={name("Longest text")}
              placeholder="1000"
              value={text("max_length")}
              disabled={disabled}
              onChange={(event) => setConfig("max_length", numberOrUndefined(event.target.value))}
            />
          </FormField>
        </div>
      )}

      {type === "long_text" && (
        <FormField label="Longest text (characters)">
          <Input
            type="number"
            min={1}
            max={50000}
            aria-label={name("Longest text")}
            placeholder="50000"
            value={text("max_length")}
            disabled={disabled}
            onChange={(event) => setConfig("max_length", numberOrUndefined(event.target.value))}
          />
        </FormField>
      )}

      {type === "number" && (
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Decimal places">
            <Input
              type="number"
              min={0}
              max={10}
              aria-label={name("Decimal places")}
              value={config.precision === undefined ? "0" : String(config.precision)}
              disabled={disabled}
              onChange={(event) => setConfig("precision", numberOrUndefined(event.target.value) ?? 0)}
            />
          </FormField>
          <FormField label="Show as">
            <Select
              aria-label={name("Show as")}
              value={typeof config.format === "string" ? config.format : "plain"}
              disabled={disabled}
              onChange={(event) => {
                const format = event.target.value;
                const next = withConfig(config, "format", format === "plain" ? undefined : format);
                onChange({
                  ...value,
                  config: format === "currency" ? { ...next, currency: config.currency ?? "VND" } : withConfig(next, "currency", undefined),
                });
              }}
            >
              <option value="plain">Number</option>
              <option value="percent">Percent</option>
              <option value="currency">Money</option>
            </Select>
          </FormField>
          <FormField label="Lowest">
            <Input
              type="number"
              aria-label={name("Lowest")}
              value={text("min")}
              disabled={disabled}
              onChange={(event) => setConfig("min", numberOrUndefined(event.target.value))}
            />
          </FormField>
          <FormField label="Highest">
            <Input
              type="number"
              aria-label={name("Highest")}
              value={text("max")}
              disabled={disabled}
              onChange={(event) => setConfig("max", numberOrUndefined(event.target.value))}
            />
          </FormField>
          {config.format === "currency" && (
            <FormField label="Currency code">
              <Input
                aria-label={name("Currency code")}
                maxLength={3}
                value={typeof config.currency === "string" ? config.currency : "VND"}
                disabled={disabled}
                onChange={(event) => setConfig("currency", event.target.value.toUpperCase())}
              />
            </FormField>
          )}
        </div>
      )}

      {type === "date" && (
        <Checkbox
          label="Include the time"
          checked={config.include_time === true}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, config: { ...config, include_time: event.target.checked } })}
        />
      )}

      {type === "select" && (
        <Checkbox
          label="Allow more than one choice"
          checked={config.multiple === true}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, config: { ...config, multiple: event.target.checked } })}
        />
      )}

      {type === "attachment" && (
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Most files">
            <Input
              type="number"
              min={1}
              max={20}
              aria-label={name("Most files")}
              placeholder="20"
              value={text("max_files")}
              disabled={disabled}
              onChange={(event) => setConfig("max_files", numberOrUndefined(event.target.value))}
            />
          </FormField>
          <FormField label="Only these files" hint="Endings or types: .pdf, image/*">
            <Input
              aria-label={name("Only these files")}
              value={acceptDraft}
              disabled={disabled}
              onChange={(event) => {
                setAcceptDraft(event.target.value);
                setConfig("accept", acceptFromText(event.target.value));
              }}
            />
          </FormField>
        </div>
      )}

      {canBeUnique(type) && (
        <Checkbox
          label="No two records may have the same value"
          checked={value.unique}
          disabled={disabled}
          aria-label={name("Unique")}
          onChange={(event) => onChange({ ...value, unique: event.target.checked })}
        />
      )}

      {canHaveDefault(type) && (type !== "select" || options.length > 0) && (
        <FormField label="Value for new records" hint="Used when nobody gives one.">
          {type === "checkbox" ? (
            <Select
              aria-label={name("Value for new records")}
              value={value.default === true ? "true" : value.default === false ? "false" : ""}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...value,
                  default: event.target.value === "" ? null : event.target.value === "true",
                })
              }
            >
              <option value="">None</option>
              <option value="true">Checked</option>
              <option value="false">Unchecked</option>
            </Select>
          ) : type === "select" ? (
            <Select
              aria-label={name("Value for new records")}
              value={Array.isArray(value.default) ? String(value.default[0] ?? "") : ""}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...value, default: event.target.value === "" ? null : [event.target.value] })
              }
            >
              <option value="">None</option>
              {options
                .filter((option) => option.id !== "")
                .map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
            </Select>
          ) : (
            <Input
              aria-label={name("Value for new records")}
              type={type === "number" ? "number" : type === "date" ? "date" : "text"}
              step={type === "number" ? "any" : undefined}
              value={value.default === null || value.default === undefined ? "" : String(value.default)}
              disabled={disabled}
              onChange={(event) => {
                const raw = event.target.value;
                onChange({
                  ...value,
                  default: raw === "" ? null : type === "number" ? numberOrUndefined(raw) ?? null : raw,
                });
              }}
            />
          )}
        </FormField>
      )}
    </div>
  );
}
