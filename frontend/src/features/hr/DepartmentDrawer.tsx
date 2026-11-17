"use client";

import { useRef, useState } from "react";

import {
  Avatar,
  Badge,
  Button,
  Drawer,
  DrawerBody,
  DrawerFooter,
  ErrorMessage,
  FieldGroup,
  FormField,
  FormSection,
  Input,
  LoadingState,
  SegmentedControl,
  Select,
  useToast,
} from "@/components/ui";
import { UserPicker } from "@/features/tables/UserPicker";
import { useApiResource } from "@/lib/useApiResource";

import { createDepartment, listUsers, updateDepartment, type DepartmentChanges } from "./api";
import type { Department, DepartmentKind } from "./schema";

/** What the drawer is doing: adding a department, or editing one of the listed ones. */
export type DepartmentDrawerTarget = { mode: "create" } | { mode: "edit"; department: Department };

type Props = {
  target: DepartmentDrawerTarget | null;
  departments: Department[];
  onClose: () => void;
  /** After each department is added; the drawer stays open for the next one. */
  onCreated: () => void;
  /** After an edit is saved; the drawer closes. */
  onSaved: () => void;
};

const KIND_OPTIONS: { value: DepartmentKind; label: string }[] = [
  { value: "department", label: "Department" },
  { value: "division", label: "Division" },
];

export function DepartmentDrawer({ target, departments, onClose, onCreated, onSaved }: Props) {
  const key = target === null ? "closed" : target.mode === "edit" ? target.department.id : "new";
  const department = target?.mode === "edit" ? target.department : null;
  return (
    <Drawer
      key={key}
      open={target !== null}
      title={department ? department.name : "New department"}
      onClose={onClose}
    >
      {target && (
        <DepartmentForm
          department={department}
          departments={departments}
          onClose={onClose}
          onCreated={onCreated}
          onSaved={onSaved}
        />
      )}
    </Drawer>
  );
}

function DepartmentForm({
  department,
  departments,
  onClose,
  onCreated,
  onSaved,
}: {
  department: Department | null;
  departments: Department[];
  onClose: () => void;
  onCreated: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(department?.name ?? "");
  const [kind, setKind] = useState<DepartmentKind>(department?.kind ?? "department");
  const [parentId, setParentId] = useState(department?.parent_id ?? "");
  const [headIds, setHeadIds] = useState<string[]>(department?.head_user_id ? [department.head_user_id] : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  const divisions = departments.filter((item) => item.kind === "division");
  // A division sits at the top; only a department can sit under one.
  const underDivision = kind === "department";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    setBusy(true);
    setError(null);
    try {
      if (department) {
        const changes: DepartmentChanges = {};
        if (trimmed !== department.name) changes.name = trimmed;
        if (underDivision && (parentId || null) !== department.parent_id) {
          changes.parent_id = parentId || null;
        }
        if ((headIds[0] ?? null) !== department.head_user_id) changes.head_user_id = headIds[0] ?? null;
        if (Object.keys(changes).length > 0) await updateDepartment(department.id, changes);
        onSaved();
      } else {
        await createDepartment({
          name: trimmed,
          kind,
          parent_id: underDivision && parentId ? parentId : null,
          head_user_id: headIds[0] ?? null,
        });
        toast(`Created “${trimmed}”.`);
        setName("");
        setHeadIds([]);
        onCreated();
        nameInput.current?.focus();
      }
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      aria-label={department ? `Edit ${department.name}` : "Add department"}
      className="flex min-h-0 flex-1 flex-col"
    >
      <DrawerBody>
        <FormField label="Name">
          <Input
            ref={nameInput}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={200}
            required
          />
        </FormField>

        {department ? (
          <p className="m-0 text-sm text-muted">
            <Badge tone={department.kind === "division" ? "info" : "neutral"}>
              {department.kind === "division" ? "Division" : "Department"}
            </Badge>{" "}
            The type cannot change. Delete it and add it again to change it.
          </p>
        ) : (
          <div className="grid gap-1.5">
            <span aria-hidden className="text-sm font-medium">
              Type
            </span>
            <SegmentedControl label="Type" options={KIND_OPTIONS} value={kind} onChange={setKind} />
            <p className="m-0 text-xs text-muted">
              {kind === "division"
                ? "A division groups several departments. It sits at the top level."
                : "A department is a team. It can sit under a division, or stand alone."}
            </p>
          </div>
        )}

        {underDivision && (
          <FormField
            label="Under division"
            hint={
              department
                ? "Move the team to another division here."
                : "Leave empty for a top-level department."
            }
          >
            <Select value={parentId} onChange={(event) => setParentId(event.target.value)}>
              <option value="">None (top level)</option>
              {divisions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </FormField>
        )}

        <FieldGroup label="Head" hint="Optional. It can be set later.">
          <UserPicker label="Head" value={headIds} onChange={setHeadIds} multiple={false} />
        </FieldGroup>

        {department && <People department={department} />}

        <ErrorMessage error={error} />
      </DrawerBody>
      <DrawerFooter>
        <Button type="submit" variant="primary" loading={busy}>
          {department ? "Save changes" : "Add department"}
        </Button>
        <Button onClick={onClose} disabled={busy}>
          {department ? "Cancel" : "Close"}
        </Button>
        {!department && <span className="ml-auto text-xs text-muted">Stays open for the next one</span>}
      </DrawerFooter>
    </form>
  );
}

/** The employees of a department, read only: a person's department is changed in their own panel. */
function People({ department }: { department: Department }) {
  const people = useApiResource(
    (signal) => listUsers({ q: "", status: "", departmentId: department.id }, null, signal),
    "Could not load the people of this department.",
    [department.id],
  );
  return (
    <FormSection title={`People · ${department.member_count}`}>
      {people.kind === "loading" && <LoadingState>Loading…</LoadingState>}
      {people.kind === "error" && <p className="m-0 text-sm text-muted">{people.message}</p>}
      {people.kind === "ready" && people.data.items.length === 0 && (
        <p className="m-0 text-sm text-muted">Nobody is in this department yet.</p>
      )}
      {people.kind === "ready" && people.data.items.length > 0 && (
        <ul aria-label="People in this department" className="m-0 grid list-none gap-1.5 p-0">
          {people.data.items.map((user) => (
            <li key={user.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5">
                <Avatar name={user.full_name} className="size-5 text-[10px]" />
                {user.full_name}
              </span>
              <span className="font-mono text-xs text-muted">{user.employee_code}</span>
            </li>
          ))}
        </ul>
      )}
      {people.kind === "ready" && people.data.next_cursor !== null && (
        <p className="m-0 text-xs text-muted">Showing the first {people.data.items.length}.</p>
      )}
      <p className="m-0 text-xs text-muted">Change a person&apos;s department in their own panel.</p>
    </FormSection>
  );
}
