"use client";

import { ChoiceChips } from "./ChoiceChips";
import { LinkPicker } from "./LinkPicker";
import type { FieldItem } from "./schema";
import { UserPicker } from "./UserPicker";
import {
  displayValue,
  isComputed,
  isMultiple,
  maxLengthOf,
  optionsOf,
  textFormat,
  type Draft,
} from "./values";

type Props = {
  field: FieldItem;
  draft: Draft;
  /** The stored value, used to show computed fields (they have no input). */
  value: unknown;
  names: ReadonlyMap<string, string>;
  onChange: (draft: Draft) => void;
  disabled: boolean;
  error?: string;
};

/** The input for one cell in the record panel. */
export function FieldEditor({ field, draft, value, names, onChange, disabled, error }: Props) {
  const id = `cell-${field.id}`;
  const errorId = `${id}-error`;
  const common = {
    id,
    disabled,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? errorId : undefined,
  } as const;

  let input: React.ReactNode;
  if (isComputed(field)) {
    input = <output id={id}>{displayValue(field, value, names) || "—"}</output>;
  } else {
    switch (field.type) {
      case "long_text":
        input = (
          <textarea
            {...common}
            rows={4}
            maxLength={maxLengthOf(field)}
            value={String(draft)}
            onChange={(event) => onChange(event.target.value)}
          />
        );
        break;
      case "number":
        input = (
          <input
            {...common}
            type="number"
            step="any"
            min={typeof field.config.min === "number" ? field.config.min : undefined}
            max={typeof field.config.max === "number" ? field.config.max : undefined}
            value={String(draft)}
            onChange={(event) => onChange(event.target.value)}
          />
        );
        break;
      case "date":
        input = (
          <input
            {...common}
            type={field.config.include_time === true ? "datetime-local" : "date"}
            value={String(draft)}
            onChange={(event) => onChange(event.target.value)}
          />
        );
        break;
      case "checkbox":
        input = (
          <input
            {...common}
            type="checkbox"
            checked={draft === true}
            onChange={(event) => onChange(event.target.checked)}
          />
        );
        break;
      case "status":
        input = (
          <ChoiceChips
            label={field.name}
            options={optionsOf(field)}
            value={draft === "" ? [] : [String(draft)]}
            onChange={(ids) => onChange(ids[0] ?? "")}
            multiple={false}
            disabled={disabled}
          />
        );
        break;
      case "select":
        // A select always holds a list; a column that takes one choice holds a list of one.
        input = (
          <ChoiceChips
            label={field.name}
            options={optionsOf(field)}
            value={Array.isArray(draft) ? draft : []}
            onChange={onChange}
            multiple={isMultiple(field)}
            disabled={disabled}
          />
        );
        break;
      case "user":
        input = (
          <UserPicker
            label={field.name}
            value={Array.isArray(draft) ? draft : []}
            onChange={onChange}
            multiple={isMultiple(field)}
            disabled={disabled}
          />
        );
        break;
      case "link_record":
        input = (
          <LinkPicker
            field={field}
            value={Array.isArray(draft) ? draft : []}
            onChange={onChange}
            disabled={disabled}
          />
        );
        break;
      default:
        input = (
          <input
            {...common}
            type={
              textFormat(field) === "url"
                ? "url"
                : textFormat(field) === "email"
                  ? "email"
                  : textFormat(field) === "phone"
                    ? "tel"
                    : "text"
            }
            maxLength={maxLengthOf(field)}
            value={String(draft)}
            onChange={(event) => onChange(event.target.value)}
          />
        );
    }
  }

  const labelled =
    field.type === "select" ||
    field.type === "status" ||
    field.type === "user" ||
    field.type === "link_record";
  return (
    <div className="cell-editor">
      {labelled ? (
        <div className="label">
          {field.name}
          {field.is_required && <span aria-hidden="true"> *</span>}
        </div>
      ) : (
        <label htmlFor={id}>
          {field.name}
          {field.is_required && <span aria-hidden="true"> *</span>}
        </label>
      )}
      {field.description && <p className="field-hint m-0 text-xs text-muted">{field.description}</p>}
      {input}
      {error && (
        <p id={errorId} role="alert" className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
