"use client";

import { useRef, useState } from "react";

import {
  Alert,
  Button,
  Drawer,
  DrawerBody,
  DrawerFooter,
  FormField,
  Input,
  Select,
} from "@/components/ui";
import { LEVEL_LABELS, type User, type UserLevel } from "@/features/auth/schema";

import { createUser, updateUser, type UserChanges } from "./api";
import { departmentLabel } from "./departmentTree";
import { ErrorMessage } from "./ErrorMessage";
import type { Department } from "./schema";

const LEVELS = Object.keys(LEVEL_LABELS) as UserLevel[];

/** What the drawer is doing: adding a new employee, or editing one of the listed ones. */
export type UserDrawerTarget = { mode: "create" } | { mode: "edit"; user: User };

type Props = {
  target: UserDrawerTarget | null;
  departments: Department[];
  /** The signed-in admin: they may edit their own name and department, but not their own level. */
  meId: string | null;
  onClose: () => void;
  /** After an employee is added; the drawer stays open for the next one. */
  onCreated: () => void;
  /** After an edit is saved; the drawer closes. */
  onSaved: () => void;
};

export function UserDrawer({ target, departments, meId, onClose, onCreated, onSaved }: Props) {
  const key = target === null ? "closed" : target.mode === "edit" ? target.user.id : "new";
  return (
    <Drawer
      key={key}
      open={target !== null}
      title={target?.mode === "edit" ? target.user.full_name : "New employee"}
      subtitle={target?.mode === "edit" ? target.user.employee_code : undefined}
      onClose={onClose}
    >
      {target && (
        <UserForm
          target={target}
          departments={departments}
          isSelf={target.mode === "edit" && target.user.id === meId}
          onClose={onClose}
          onCreated={onCreated}
          onSaved={onSaved}
        />
      )}
    </Drawer>
  );
}

function UserForm({
  target,
  departments,
  isSelf,
  onClose,
  onCreated,
  onSaved,
}: {
  target: UserDrawerTarget;
  departments: Department[];
  isSelf: boolean;
  onClose: () => void;
  onCreated: () => void;
  onSaved: () => void;
}) {
  const existing = target.mode === "edit" ? target.user : null;
  const [employeeCode, setEmployeeCode] = useState("");
  const [fullName, setFullName] = useState(existing?.full_name ?? "");
  const [password, setPassword] = useState("");
  const [level, setLevel] = useState<UserLevel>(existing?.level ?? "employee");
  const [departmentId, setDepartmentId] = useState(existing?.department_id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<string | null>(null);
  const firstField = useRef<HTMLInputElement>(null);

  // The owner is protected by the backend. Admins also cannot change their own role or status.
  const levelLocked = existing !== null && (existing.org_role === "owner" || isSelf);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      if (existing) {
        const changes: UserChanges = {
          full_name: fullName.trim(),
          department_id: departmentId || null,
        };
        if (!levelLocked && level !== existing.level) {
          changes.level = level;
          changes.org_role = level === "admin" ? "admin" : "member";
        }
        await updateUser(existing.id, changes);
        onSaved();
      } else {
        const user = await createUser({
          employee_code: employeeCode.trim(),
          full_name: fullName.trim(),
          password,
          level,
          // The business level "admin" and the organization role "admin" always go together.
          org_role: level === "admin" ? "admin" : "member",
          department_id: departmentId || null,
        });
        setCreated(user.employee_code);
        setEmployeeCode("");
        setFullName("");
        setPassword("");
        setLevel("employee");
        setDepartmentId("");
        onCreated();
        firstField.current?.focus();
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
      aria-label={existing ? `Edit ${existing.employee_code}` : "Add employee"}
      className="flex min-h-0 flex-1 flex-col"
    >
      <DrawerBody>
        {!existing && (
          <FormField label="Employee code" hint="They sign in with this code.">
            <Input
              ref={firstField}
              value={employeeCode}
              onChange={(event) => setEmployeeCode(event.target.value)}
              maxLength={50}
              required
            />
          </FormField>
        )}
        <FormField label="Full name">
          <Input
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            maxLength={200}
            required
          />
        </FormField>
        {!existing && (
          <FormField label="Initial password" hint="At least 8 characters. Tell it to the employee.">
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              required
            />
          </FormField>
        )}
        <FormField
          label="Level"
          hint={
            levelLocked
              ? "You cannot change this level."
              : "The Admin level also gives access to this Human resources area."
          }
        >
          <Select
            value={level}
            disabled={levelLocked}
            onChange={(event) => setLevel(event.target.value as UserLevel)}
          >
            {LEVELS.map((item) => (
              <option key={item} value={item}>
                {LEVEL_LABELS[item]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Department">
          <Select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
            <option value="">None</option>
            {departments.map((item) => (
              <option key={item.id} value={item.id}>
                {departmentLabel(item, departments)}
              </option>
            ))}
          </Select>
        </FormField>

        <ErrorMessage error={error} />
        {created && (
          <Alert tone="success">Employee {created} created. Add another, or close.</Alert>
        )}
      </DrawerBody>
      <DrawerFooter>
        <Button type="submit" variant="primary" loading={busy}>
          {existing ? "Save changes" : "Add employee"}
        </Button>
        <Button onClick={onClose} disabled={busy}>
          {existing ? "Cancel" : "Close"}
        </Button>
      </DrawerFooter>
    </form>
  );
}
