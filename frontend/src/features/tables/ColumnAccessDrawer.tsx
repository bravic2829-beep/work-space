"use client";

import { Eye, EyeOff, Lock, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  Alert,
  Avatar,
  Badge,
  Button,
  Drawer,
  DrawerBody,
  DrawerFooter,
  LoadingState,
  Select,
} from "@/components/ui";
import { ApiError } from "@/lib/api/client";

import { LABELS } from "./AddFieldForm";
import { getTableAccess, setPersonAccess } from "./api";
import type { FieldAccess, FieldItem, PersonAccess } from "./schema";
import { UserPicker } from "./UserPicker";
import { useUserNames } from "./useUserNames";

type Props = {
  tableId: string;
  fields: FieldItem[];
  onClose: () => void;
};

/** What the person gets of one column: nothing special, read only, or not shown at all. */
type Choice = "default" | "read" | "hidden";

const CHOICE_LABEL: Record<Choice, string> = {
  default: "As their role allows",
  read: "Read only",
  hidden: "Hidden",
};

/** A stored "edit" rule gives nothing beyond the role, so it is shown as the default. */
function choiceOf(access: FieldAccess | undefined): Choice {
  return access === "hidden" || access === "read" ? access : "default";
}

function draftOf(person: PersonAccess | undefined, fields: FieldItem[]): Record<string, Choice> {
  const stored = new Map(person?.rules.map((rule) => [rule.field_id, rule.access]));
  return Object.fromEntries(fields.map((field) => [field.id, choiceOf(stored.get(field.id))]));
}

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready" };

/**
 * "Column access": choose one person, then choose for each column whether they see it as their
 * role allows, only read it, or do not see it at all. A rule can only narrow what the person's
 * role gives, never widen it; organization admins are never restricted. Saved in one go.
 */
export function ColumnAccessDrawer({ tableId, fields, onClose }: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [people, setPeople] = useState<PersonAccess[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [draft, setDraft] = useState<Record<string, Choice>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const personId = chosen[0];
  const names = useUserNames([...people.map((p) => p.user_id), ...chosen]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        setPeople(await getTableAccess(tableId, controller.signal));
        setState({ kind: "ready" });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          kind: "error",
          message:
            error instanceof ApiError && error.status === 403
              ? "Only the admins of this workspace can choose who sees which column."
              : error instanceof ApiError
                ? error.message
                : "Could not load the column rules.",
        });
      }
    }
    void load();
    return () => controller.abort();
  }, [tableId, reloadKey]);

  const current = useMemo(() => people.find((p) => p.user_id === personId), [people, personId]);
  const initial = useMemo(() => draftOf(current, fields), [current, fields]);

  function pick(ids: string[]) {
    setChosen(ids);
    setSaved(null);
    setMessage(null);
    const person = people.find((p) => p.user_id === ids[0]);
    setDraft(draftOf(person, fields));
  }

  function setAll(make: (field: FieldItem, index: number) => Choice) {
    setDraft(Object.fromEntries(fields.map((field, index) => [field.id, make(field, index)])));
    setSaved(null);
  }

  // Only the columns that changed are sent: "default" sends null, which removes the rule.
  const changes = fields.filter((field) => (draft[field.id] ?? "default") !== initial[field.id]);
  const hiddenCount = fields.filter((field) => draft[field.id] === "hidden").length;

  async function save() {
    if (!personId) return;
    setBusy(true);
    setMessage(null);
    try {
      const body: Record<string, FieldAccess | null> = {};
      for (const field of changes) {
        const choice = draft[field.id];
        body[field.id] = choice === "default" ? null : choice;
      }
      const updated = await setPersonAccess(tableId, personId, body);
      setPeople((all) => {
        const rest = all.filter((p) => p.user_id !== personId);
        return updated.rules.length > 0 ? [...rest, updated] : rest;
      });
      setDraft(draftOf(updated, fields));
      setSaved(`Saved. ${names.get(personId) ?? "This person"} sees the columns as shown below.`);
      setReloadKey((n) => n + 1);
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Could not save the rules.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open title="Column access" onClose={onClose} wide>
      <DrawerBody>
        <div className="flex flex-col gap-4">
          <p className="m-0 rounded-md bg-primary-soft px-3 py-2 text-xs text-primary">
            Choose who sees which columns of this table. A rule can only reduce what a person’s
            role gives (it never lets them do more). Organization admins always see everything.
          </p>

          {state.kind === "loading" && <LoadingState>Loading…</LoadingState>}
          {state.kind === "error" && <Alert>{state.message}</Alert>}

          {state.kind === "ready" && (
            <>
              {people.length > 0 && (
                <section aria-label="People with special access" className="grid gap-1.5">
                  <h3 className="m-0 text-sm">People with special access</h3>
                  <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                    {people.map((person) => {
                      const hidden = person.rules.filter((r) => r.access === "hidden").length;
                      const label = names.get(person.user_id) ?? "…";
                      return (
                        <li key={person.user_id}>
                          <button
                            type="button"
                            aria-pressed={person.user_id === personId}
                            className="gap-1.5 rounded-full px-2.5 py-1 text-[13px] aria-pressed:border-primary aria-pressed:bg-primary-soft"
                            onClick={() => pick([person.user_id])}
                          >
                            {label}
                            <Badge>{hidden > 0 ? `${hidden} hidden` : "read only"}</Badge>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              <section aria-label="Person" className="grid gap-1">
                <h3 className="m-0 text-sm">Person</h3>
                <UserPicker
                  label="Person"
                  value={chosen}
                  onChange={pick}
                  multiple={false}
                  disabled={busy}
                />
              </section>

              {personId && (
                <section aria-label="Columns" className="grid gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="m-0 flex items-center gap-2 text-sm">
                      <Avatar name={names.get(personId) ?? "?"} className="size-6 text-[10px]" />
                      {names.get(personId) ?? "…"}
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" icon={Eye} onClick={() => setAll(() => "default")}>
                        Reset all
                      </Button>
                      <Button size="sm" icon={Lock} onClick={() => setAll(() => "read")}>
                        Read only everywhere
                      </Button>
                      <Button
                        size="sm"
                        icon={EyeOff}
                        onClick={() => setAll((_, index) => (index === 0 ? "default" : "hidden"))}
                      >
                        Hide all but the first column
                      </Button>
                    </div>
                  </div>
                  <ul aria-label="Columns of the table" className="m-0 grid list-none gap-1 p-0">
                    {fields.map((field) => (
                      <li
                        key={field.id}
                        className="flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5"
                      >
                        <span className="min-w-0 flex-1 truncate font-medium">{field.name}</span>
                        <Badge>{LABELS[field.type]}</Badge>
                        <Select
                          aria-label={`Access to ${field.name}`}
                          className="h-8 w-auto py-0 text-[13px]"
                          value={draft[field.id] ?? "default"}
                          disabled={busy}
                          onChange={(event) => {
                            setDraft((d) => ({ ...d, [field.id]: event.target.value as Choice }));
                            setSaved(null);
                          }}
                        >
                          {(Object.keys(CHOICE_LABEL) as Choice[]).map((choice) => (
                            <option key={choice} value={choice}>
                              {CHOICE_LABEL[choice]}
                            </option>
                          ))}
                        </Select>
                      </li>
                    ))}
                  </ul>
                  <p className="m-0 text-xs text-muted">
                    {hiddenCount === 0
                      ? "Nothing is hidden from this person."
                      : `${hiddenCount} of ${fields.length} columns are hidden from this person: they do not appear in the table, the task panel, the history, the reports or the files.`}
                  </p>
                </section>
              )}

              {message && <Alert>{message}</Alert>}
              {saved && <Alert tone="success">{saved}</Alert>}
            </>
          )}
        </div>
      </DrawerBody>
      <DrawerFooter>
        <Button
          variant="primary"
          icon={Save}
          loading={busy}
          disabled={!personId || changes.length === 0}
          onClick={() => void save()}
        >
          Save access
        </Button>
        <Button onClick={onClose}>Close</Button>
      </DrawerFooter>
    </Drawer>
  );
}
