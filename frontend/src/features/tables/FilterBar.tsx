"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";

import {
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  usePopoverClose,
} from "@/components/ui";

import type { Condition, FieldItem } from "./schema";
import { conditionValue, describeCondition, operatorsFor, optionsOf } from "./values";

type Props = {
  fields: FieldItem[];
  filter: Condition[];
  onChange: (filter: Condition[]) => void;
  /** Buttons beside "Filter" (the sort menu). */
  children?: React.ReactNode;
  /** Shown at the right end of the row (the columns menu). */
  trailing?: React.ReactNode;
};

const FIELD = "h-8 w-full py-0 text-[13px] leading-5";

/** The form inside the "Filter" popover: pick a column, how to compare, and the value. */
function FilterForm({
  fields,
  onAdd,
}: {
  fields: FieldItem[];
  onAdd: (condition: Condition) => void;
}) {
  const close = usePopoverClose();
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
    onAdd(condition);
    close();
  }

  function valueInput() {
    if (!field || !chosen?.needsValue) return null;
    if (field.type === "checkbox") {
      return (
        <Select
          aria-label="Value"
          className={FIELD}
          value={text}
          onChange={(e) => setText(e.target.value)}
        >
          <option value="true">checked</option>
          <option value="false">unchecked</option>
        </Select>
      );
    }
    if (["single_select", "status", "multi_select"].includes(field.type)) {
      return (
        <Select
          aria-label="Value"
          className={FIELD}
          value={text}
          onChange={(e) => setText(e.target.value)}
        >
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
        className={FIELD}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    );
  }

  return (
    <form onSubmit={add} className="grid gap-2">
      <Select
        aria-label="Filter column"
        className={FIELD}
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
        <Select
          aria-label="Operator"
          className={FIELD}
          value={op}
          onChange={(e) => setOp(e.target.value)}
        >
          {operators.map((o) => (
            <option key={o.op} value={o.op}>
              {o.label}
            </option>
          ))}
        </Select>
      )}
      {valueInput()}
      <Button type="submit" size="sm" variant="primary" icon={Plus} disabled={!canAdd}>
        Add filter
      </Button>
    </form>
  );
}

/**
 * The filter row of a table: a "Filter" button that opens the form, the conditions in force as
 * chips, and room for the sort menu and the columns menu. Values never become SQL.
 */
export function FilterBar({ fields, filter, onChange, children, trailing }: Props) {
  return (
    <section aria-label="Filters" className="flex flex-wrap items-center gap-2">
      <Popover>
        <PopoverTrigger
          render={
            <Button size="sm" icon={Plus}>
              Filter
            </Button>
          }
        />
        <PopoverContent className="w-72 p-3">
          <FilterForm fields={fields} onAdd={(condition) => onChange([...filter, condition])} />
        </PopoverContent>
      </Popover>
      {children}
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
      {trailing && <div className="ml-auto">{trailing}</div>}
    </section>
  );
}
