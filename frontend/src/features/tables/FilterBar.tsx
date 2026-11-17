"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";

import { Button, Input, Select } from "@/components/ui";

import type { Condition, FieldItem } from "./schema";
import { conditionValue, describeCondition, operatorsFor, optionsOf } from "./values";

type Props = {
  fields: FieldItem[];
  filter: Condition[];
  onChange: (filter: Condition[]) => void;
  /** Shown at the right end of the bar (the show/hide columns button). */
  trailing?: React.ReactNode;
};

const SMALL = "h-8 w-auto min-w-40 py-0 text-[13px] leading-5";

/** Narrow the table to the rows that match every condition. Values never become SQL. */
export function FilterBar({ fields, filter, onChange, trailing }: Props) {
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
        <Select aria-label="Value" className={SMALL} value={text} onChange={(e) => setText(e.target.value)}>
          <option value="true">checked</option>
          <option value="false">unchecked</option>
        </Select>
      );
    }
    if (["single_select", "status", "multi_select"].includes(field.type)) {
      return (
        <Select aria-label="Value" className={SMALL} value={text} onChange={(e) => setText(e.target.value)}>
          <option value="">Choose…</option>
          {optionsOf(field).map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </Select>
      );
    }
    const type =
      field.type === "number" || field.type === "auto_number"
        ? "number"
        : field.type === "date"
          ? "date"
          : "text";
    return (
      <Input
        aria-label="Value"
        type={type}
        step={type === "number" ? "any" : undefined}
        className={`${SMALL} w-36`}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    );
  }

  return (
    <section
      aria-label="Filters"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-muted px-3 py-1.5"
    >
      <span className="text-[11px] font-semibold tracking-wider text-muted uppercase">Where</span>
      {filter.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0">
          {filter.map((condition, index) => (
            <li
              key={`${condition.field}-${condition.op}-${index}`}
              className="inline-flex items-center gap-1 rounded border border-line-strong bg-surface py-0.5 pr-0.5 pl-2 text-xs"
            >
              {describeCondition(fields, condition)}
              <button
                type="button"
                className="size-4 rounded-sm border-0 bg-transparent p-0 text-muted hover:bg-danger-soft hover:text-danger"
                aria-label={`Remove filter ${describeCondition(fields, condition)}`}
                onClick={() => onChange(filter.filter((_, i) => i !== index))}
              >
                <X className="size-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {filter.length === 0 && <span className="text-xs text-muted">no conditions, showing everything</span>}
      <form onSubmit={add} className="flex flex-wrap items-center gap-1.5">
        <Select
          aria-label="Filter column"
          className={SMALL}
          value={fieldId}
          onChange={(e) => pickField(e.target.value)}
        >
          <option value="">Filter by…</option>
          {filterable.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </Select>
        {field && (
          <Select aria-label="Operator" className={SMALL} value={op} onChange={(e) => setOp(e.target.value)}>
            {operators.map((o) => (
              <option key={o.op} value={o.op}>
                {o.label}
              </option>
            ))}
          </Select>
        )}
        {valueInput()}
        <Button type="submit" size="sm" icon={Plus} disabled={!canAdd}>
          Add filter
        </Button>
      </form>
      {trailing && <div className="ml-auto">{trailing}</div>}
    </section>
  );
}
