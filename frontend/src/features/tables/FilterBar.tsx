"use client";

import { useState } from "react";

import type { Condition, FieldItem } from "./schema";
import {
  conditionValue,
  describeCondition,
  operatorsFor,
  optionsOf,
} from "./values";

type Props = {
  fields: FieldItem[];
  filter: Condition[];
  onChange: (filter: Condition[]) => void;
};

/** Narrow the table to the rows that match every condition. Values never become SQL. */
export function FilterBar({ fields, filter, onChange }: Props) {
  const filterable = fields.filter((field) => operatorsFor(field).length > 0);
  const [fieldId, setFieldId] = useState("");
  const [op, setOp] = useState("");
  const [text, setText] = useState("");

  const field = filterable.find((f) => f.id === fieldId);
  const operators = field ? operatorsFor(field) : [];
  const chosen = operators.find((o) => o.op === op);
  const canAdd = field !== undefined && chosen !== undefined && (!chosen.needsValue || text !== "");

  function pickField(id: string) {
    setFieldId(id);
    const next = filterable.find((f) => f.id === id);
    setOp(next ? (operatorsFor(next)[0]?.op ?? "") : "");
    setText(next?.type === "checkbox" ? "true" : "");
  }

  function add(event: React.FormEvent) {
    event.preventDefault();
    if (!field || !chosen || !canAdd) return;
    const condition: Condition = { field: field.id, op: chosen.op };
    if (chosen.needsValue) condition.value = conditionValue(field, text);
    onChange([...filter, condition]);
    setFieldId("");
    setOp("");
    setText("");
  }

  function valueInput() {
    if (!field || !chosen?.needsValue) return null;
    if (field.type === "checkbox") {
      return (
        <select aria-label="Value" value={text} onChange={(e) => setText(e.target.value)}>
          <option value="true">checked</option>
          <option value="false">unchecked</option>
        </select>
      );
    }
    if (["single_select", "status", "multi_select"].includes(field.type)) {
      return (
        <select aria-label="Value" value={text} onChange={(e) => setText(e.target.value)}>
          <option value="">Choose…</option>
          {optionsOf(field).map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      );
    }
    const type =
      field.type === "number" || field.type === "auto_number"
        ? "number"
        : field.type === "date"
          ? "date"
          : "text";
    return (
      <input
        aria-label="Value"
        type={type}
        step={type === "number" ? "any" : undefined}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    );
  }

  return (
    <section aria-label="Filters" className="filter-bar">
      {filter.length > 0 && (
        <ul className="chips">
          {filter.map((condition, index) => (
            <li key={`${condition.field}-${condition.op}-${index}`}>
              {describeCondition(fields, condition)}
              <button
                type="button"
                aria-label={`Remove filter ${describeCondition(fields, condition)}`}
                onClick={() => onChange(filter.filter((_, i) => i !== index))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="inline-form">
        <select aria-label="Filter column" value={fieldId} onChange={(e) => pickField(e.target.value)}>
          <option value="">Filter by…</option>
          {filterable.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        {field && (
          <select aria-label="Operator" value={op} onChange={(e) => setOp(e.target.value)}>
            {operators.map((o) => (
              <option key={o.op} value={o.op}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        {valueInput()}
        <button type="submit" disabled={!canAdd}>
          Add filter
        </button>
      </form>
    </section>
  );
}
