"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";

import { Alert, Badge, Button, Checkbox, Input, Select, Textarea } from "@/components/ui";

import { LABELS, ROLES } from "./AddFieldForm";
import { deleteField, updateField, type FieldPatch } from "./api";
import { optionColor } from "./colors";
import { ColorModal } from "./ColorModal";
import { FieldSettings } from "./FieldSettings";
import { canBeRequired, settingsOf, type Settings } from "./columnRules";
import { FIELD_TYPES, type FieldItem, type FieldType, type SelectOption } from "./schema";
import { errorMessage } from "@/lib/api/errors";

const CHOICE_TYPES: FieldType[] = ["select", "status"];

function isChoice(type: FieldType): boolean {
  return CHOICE_TYPES.includes(type);
}

function optionsOf(field: FieldItem): SelectOption[] {
  const raw = field.config.options;
  return Array.isArray(raw) ? (raw as SelectOption[]) : [];
}

/** Columns the system fills in: nothing to set up. */
function isSystemColumn(type: FieldType): boolean {
  return type === "created_by" || type === "created_time" || type === "auto_number" || type === "timer";
}

/** A column that has a role, grants viewing or links to another table keeps its type. */
function typeIsLocked(field: FieldItem): boolean {
  return (
    field.semantic !== null ||
    field.grants_view ||
    field.type === "link_record" ||
    field.type === "attachment"
  );
}

type RowProps = { field: FieldItem; all: FieldItem[]; onChanged: () => void };

function FieldRow({ field, all, onChanged }: RowProps) {
  const [name, setName] = useState(field.name);
  const [options, setOptions] = useState<SelectOption[]>(optionsOf(field));
  const [newOption, setNewOption] = useState("");
  const [coloring, setColoring] = useState<number | null>(null);
  const [settings, setSettings] = useState<Settings>(settingsOf(field));
  const [type, setType] = useState<FieldType>(field.type);
  const [typeOptions, setTypeOptions] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>, fallback: string) {
    setError(null);
    setBusy(true);
    try {
      await action();
      onChanged();
    } catch (caught) {
      setError(errorMessage(caught, fallback));
    } finally {
      setBusy(false);
    }
  }

  const patch = (change: FieldPatch, fallback: string) =>
    run(() => updateField(field.id, change), fallback);

  function addOption() {
    const text = newOption.trim();
    if (text === "") return;
    // A new option has no id yet: the server makes one.
    setOptions((current) => [...current, { id: "", name: text }]);
    setNewOption("");
  }

  function convert() {
    const lines = typeOptions
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const needsOptions = isChoice(type) && !isChoice(field.type) && lines.length > 0;
    void patch(
      needsOptions ? { type, config: { options: lines.map((line) => ({ name: line })) } } : { type },
      "Could not change the type.",
    );
  }

  // Parent and subtasks belong to link columns and keep their role.
  const roleChoices =
    field.semantic === "parent" || field.semantic === "subtasks" ? undefined : ROLES[field.type];
  const optionsChanged = JSON.stringify(options) !== JSON.stringify(optionsOf(field));
  const settingsChanged = JSON.stringify(settings) !== JSON.stringify(settingsOf(field));

  /** Only what changed is sent: a setting that is not touched is not asked to be valid again. */
  function saveSettings() {
    const before = settingsOf(field);
    const change: FieldPatch = {};
    if (JSON.stringify(settings.config) !== JSON.stringify(before.config)) {
      change.config = settings.config;
    }
    if (settings.description.trim() !== before.description) {
      change.description = settings.description.trim() || null;
    }
    if (settings.unique !== before.unique) change.unique = settings.unique;
    if (JSON.stringify(settings.default) !== JSON.stringify(before.default)) {
      change.default = settings.default;
    }
    void patch(change, "Could not save the settings.");
  }
  const locked = typeIsLocked(field);
  const label = field.name;

  const coloringOption = coloring === null ? undefined : options[coloring];
  return (
    <li className="rounded-lg border border-line">
      {coloringOption && coloring !== null && (
        <ColorModal
          label={coloringOption.name || "this option"}
          current={optionColor(coloringOption, coloring)}
          onCancel={() => setColoring(null)}
          onPick={(hex) => {
            setOptions((current) =>
              current.map((item, at) => (at === coloring ? { ...item, color: hex } : item)),
            );
            setColoring(null);
          }}
        />
      )}
      {/* One line per column; open it to rename, edit options, convert or delete. */}
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 hover:bg-surface-muted [&::-webkit-details-marker]:hidden">
          <ChevronRight
            className="size-4 shrink-0 text-muted transition-transform group-open:rotate-90"
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate font-medium">{field.name}</span>
          {field.is_required && <Badge tone="warning">required</Badge>}
          {field.type === "user" && field.semantic === null && (
            <Badge tone="warning">no role</Badge>
          )}
          {field.semantic && field.semantic !== "parent" && field.semantic !== "subtasks" && (
            <Badge tone="info">{field.semantic.replace("_", " ")}</Badge>
          )}
          <Badge>{LABELS[field.type]}</Badge>
        </summary>
        <div className="grid gap-3 border-t border-line p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid min-w-48 flex-1 gap-1 text-sm font-medium">
          Name
          <Input
            aria-label={`Name of ${label}`}
            value={name}
            maxLength={200}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <Button
          size="sm"
          disabled={busy || name.trim() === "" || name.trim() === field.name}
          onClick={() => void patch({ name: name.trim() }, "Could not rename the column.")}
          aria-label={`Rename ${label}`}
        >
          Rename
        </Button>
        <span className="pb-1.5 text-xs text-muted">{LABELS[field.type]}</span>
      </div>

      {canBeRequired(field.type) && (
      <Checkbox
        label="Required"
        checked={field.is_required}
        disabled={busy}
        aria-label={`${label} is required`}
        onChange={(event) =>
          void patch({ is_required: event.target.checked }, "Could not change this setting.")
        }
      />
      )}

      {field.type !== "link_record" && field.type !== "status" && !isSystemColumn(field.type) && (
        <div className="grid gap-2">
          <FieldSettings
            type={field.type}
            value={settings}
            onChange={setSettings}
            options={options}
            disabled={busy}
            label={label}
          />
          <div>
            <Button
              size="sm"
              variant="primary"
              disabled={busy || !settingsChanged}
              onClick={saveSettings}
              aria-label={`Save settings of ${label}`}
            >
              Save settings
            </Button>
          </div>
        </div>
      )}

      {roleChoices && (
        <div className="grid gap-1.5">
          <label className="grid gap-1 text-sm font-medium">
            Role of this column
            <Select
              aria-label={`Role of ${label}`}
              value={field.semantic ?? ""}
              disabled={busy}
              onChange={(event) =>
                void patch({ semantic: event.target.value || null }, "Could not change the role.")
              }
            >
              <option value="">No role</option>
              {roleChoices.map((item) => {
                const taken = all.some((f) => f.id !== field.id && f.semantic === item.value);
                return (
                  <option key={item.value} value={item.value} disabled={taken}>
                    {item.label}
                    {taken ? " (the table already has one)" : ""}
                  </option>
                );
              })}
            </Select>
          </label>
          {field.type === "user" && field.semantic === null && (
            <Alert tone="warning">
              Nobody is notified and nobody sees the task because of this column. Choose Assignee
              to give tasks to the people named in it.
            </Alert>
          )}
        </div>
      )}

      {isChoice(field.type) && (
        <div className="grid gap-2">
          <p className="m-0 text-sm font-medium">Options</p>
          <ul className="m-0 grid list-none gap-1.5 p-0" aria-label={`Options of ${label}`}>
            {options.map((option, index) => (
              <li key={option.id || `new-${index}`}>
                <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label={`Color of option ${option.name} in ${label}`}
                  title="Change color"
                  onClick={() => setColoring(index)}
                  className="size-7 shrink-0 cursor-pointer rounded-full border border-line p-0"
                  style={{ backgroundColor: optionColor(option, index) }}
                />
                <Input
                  aria-label={`Option ${index + 1} of ${label}`}
                  value={option.name}
                  maxLength={100}
                  onChange={(event) =>
                    setOptions((current) =>
                      current.map((item, at) =>
                        at === index ? { ...item, name: event.target.value } : item,
                      ),
                    )
                  }
                />
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove option ${option.name} from ${label}`}
                  onClick={() => setOptions((current) => current.filter((_, at) => at !== index))}
                >
                  Remove
                </Button>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2">
            <Input
              aria-label={`New option for ${label}`}
              placeholder="New option"
              value={newOption}
              maxLength={100}
              onChange={(event) => setNewOption(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addOption();
                }
              }}
            />
            <Button size="sm" disabled={newOption.trim() === ""} onClick={addOption}>
              Add option
            </Button>
          </div>
          <div>
            <Button
              size="sm"
              variant="primary"
              disabled={busy || !optionsChanged || options.some((o) => o.name.trim() === "")}
              onClick={() =>
                // Existing options keep their id, so renaming never touches the records.
                void patch(
                  {
                    config: {
                      ...field.config,
                      // Existing options keep their id and color. A new one gets a color from the
                      // server unless one was picked.
                      options: options.map((o) => ({
                        ...(o.id ? { id: o.id } : {}),
                        name: o.name.trim(),
                        ...(o.color ? { color: o.color } : {}),
                        ...(o.kind ? { kind: o.kind } : {}),
                      })),
                    },
                  },
                  "Could not save the options.",
                )
              }
              aria-label={`Save options of ${label}`}
            >
              Save options
            </Button>
          </div>
        </div>
      )}

      {!locked && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-sm font-medium">
            Change type
            <Select
              aria-label={`Type of ${label}`}
              value={type}
              onChange={(event) => setType(event.target.value as FieldType)}
            >
              {FIELD_TYPES.filter((t) => t !== "link_record" && t !== "attachment").map((t) => (
                <option key={t} value={t}>
                  {LABELS[t]}
                </option>
              ))}
            </Select>
          </label>
          <Button
            size="sm"
            disabled={busy || type === field.type}
            onClick={convert}
            aria-label={`Convert ${label}`}
          >
            Convert
          </Button>
        </div>
      )}
      {!locked && isChoice(type) && !isChoice(field.type) && type !== field.type && (
        <label className="grid gap-1 text-sm font-medium">
          Options the existing values become (one per line)
          <Textarea
            rows={3}
            aria-label={`Options for converting ${label}`}
            value={typeOptions}
            onChange={(event) => setTypeOptions(event.target.value)}
          />
        </label>
      )}

      {error && <Alert>{error}</Alert>}

      <div>
        {!confirmingDelete ? (
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Delete ${label}`}
            onClick={() => setConfirmingDelete(true)}
          >
            Delete column
          </Button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">
              Delete “{label}”? The values stay stored, but the column disappears.
            </span>
            <Button
              size="sm"
              variant="danger"
              loading={busy}
              aria-label={`Confirm delete ${label}`}
              onClick={() => void run(() => deleteField(field.id), "Could not delete the column.")}
            >
              Delete
            </Button>
            <Button size="sm" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </Button>
          </div>
        )}
      </div>
        </div>
      </details>
    </li>
  );
}

/** Rename, edit options, convert and delete columns (editors and admins). */
export function ManageFieldsPanel({
  fields,
  onChanged,
}: {
  fields: FieldItem[];
  onChanged: () => void;
}) {
  return (
    <section aria-label="Manage columns" className="grid gap-3">
      <ul className="m-0 grid list-none gap-2 p-0">
        {fields.map((field) => (
          // The key includes what the server can change, so a saved column shows its new values.
          <FieldRow
            key={`${field.id}-${field.name}-${field.type}-${field.semantic}-${JSON.stringify(field.config)}`}
            field={field}
            all={fields}
            onChanged={onChanged}
          />
        ))}
      </ul>
    </section>
  );
}
