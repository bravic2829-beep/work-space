"use client";

import { useRef, useState } from "react";

import { Alert, Button, Drawer, DrawerBody, DrawerFooter, ErrorMessage, FormField, Input, Select } from "@/components/ui";
import { LEVEL_LABELS, type User, type UserLevel } from "@/features/auth/schema";

import { createUser, resetPassword, updateUser, type UserChanges } from "./api";
import { departmentLabel } from "./departmentTree";
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
          // Blank means "pick the next code for me".
          employee_code: employeeCode.trim() || undefined,
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
          <FormField
            label="Employee code"
            hint="They sign in with this code. Leave blank to generate the next one (NV001, NV002, ...)."
          >
            <Input
              ref={firstField}
              value={employeeCode}
              onChange={(event) => setEmployeeCode(event.target.value)}
              placeholder="Auto"
              maxLength={50}
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

        {existing && !isSelf && existing.org_role !== "owner" && (
          <ResetPasswordSection userId={existing.id} />
        )}

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

/** A random temporary password (no look-alike characters) the admin can read out. */
function randomPassword(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

/**
 * For an employee who forgot their password: the admin sets a temporary one and tells it to them.
 * They are signed out everywhere and must choose their own at the next sign-in. It sits inside the
 * edit form, so it is not a form of its own, and Enter here must not save the form.
 */
function ResetPasswordSection({ userId }: { userId: string }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [doneWith, setDoneWith] = useState<string | null>(null);

  async function reset() {
    setBusy(true);
    setError(null);
    setDoneWith(null);
    try {
      await resetPassword(userId, password);
      setDoneWith(password);
      setPassword("");
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Reset password"
      className="grid gap-2 border-t border-line pt-3"
    >
      <FormField
        label="Reset password"
        hint="For someone who forgot it. They are signed out and must choose a new one at the next sign-in."
      >
        <div className="flex gap-2">
          <Input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (password.length >= 8 && !busy) void reset();
              }
            }}
            placeholder="Temporary password"
            autoComplete="off"
            minLength={8}
            maxLength={128}
          />
          <Button onClick={() => setPassword(randomPassword())} disabled={busy}>
            Generate
          </Button>
        </div>
      </FormField>
      <div>
        <Button
          variant="danger"
          loading={busy}
          disabled={password.length < 8}
          onClick={() => void reset()}
        >
          Reset password
        </Button>
      </div>
      <ErrorMessage error={error} />
      {doneWith && (
        <Alert tone="success">
          Password reset. Tell the employee their temporary password:{" "}
          <strong>{doneWith}</strong>
        </Alert>
      )}
    </section>
  );
}
