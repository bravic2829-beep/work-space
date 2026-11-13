"use client";

import { LinkPicker } from "./LinkPicker";
import type { FieldItem } from "./schema";
import { UserPicker } from "./UserPicker";
import {
  displayValue,
  isComputed,
  isMultiple,
  optionsOf,
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
      case "single_select":
      case "status":
        input = (
          <select
            {...common}
            value={String(draft)}
            onChange={(event) => onChange(event.target.value)}
          >
            <option value="">—</option>
            {optionsOf(field).map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        );
        break;
      case "multi_select": {
        const chosen = Array.isArray(draft) ? draft : [];
        input = (
          <fieldset disabled={disabled} className="options">
            <legend className="visually-hidden">{field.name}</legend>
            {optionsOf(field).map((option) => (
              <label key={option.id}>
                <input
                  type="checkbox"
                  checked={chosen.includes(option.id)}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...chosen, option.id]
                        : chosen.filter((other) => other !== option.id),
                    )
                  }
                />{" "}
                {option.name}
              </label>
            ))}
          </fieldset>
        );
        break;
      }
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
            type={field.type === "url" ? "url" : "text"}
            value={String(draft)}
            onChange={(event) => onChange(event.target.value)}
          />
        );
    }
  }

  const labelled = field.type === "multi_select" || field.type === "user" || field.type === "link_record";
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
      {input}
      {error && (
        <p id={errorId} role="alert" className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
