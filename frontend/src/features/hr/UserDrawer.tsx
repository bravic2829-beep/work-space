"use client";

import { useRef, useState } from "react";

import {
  Alert,
  Avatar,
  Button,
  Drawer,
  DrawerBody,
  DrawerFooter,
  ErrorMessage,
  FieldGroup,
  FormField,
  FormSection,
  Input,
  SegmentedControl,
  Select,
  useToast,
} from "@/components/ui";
import type { User, UserLevel } from "@/features/auth/schema";
import { UserPicker } from "@/features/tables/UserPicker";

import { createUser, resetPassword, updateUser, type UserChanges } from "./api";
import { departmentLabel } from "./departmentTree";
import { LevelPicker } from "./LevelPicker";
import { PasswordInput } from "./PasswordInput";
import type { Department } from "./schema";

/**
 * What the drawer is doing: adding a new employee, or editing one of the listed ones (`section`
 * says which part to open first, for "Reset password" in the row menu).
 */
export type UserDrawerTarget =
  | { mode: "create" }
  | { mode: "edit"; user: User; section?: "password" };

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

const STATUS_OPTIONS: { value: "active" | "disabled"; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "disabled", label: "Disabled" },
];

export function UserDrawer({ target, departments, meId, onClose, onCreated, onSaved }: Props) {
  const key = target === null ? "closed" : target.mode === "edit" ? target.user.id : "new";
  const editing = target?.mode === "edit" ? target.user : null;
  return (
    <Drawer
      key={key}
      open={target !== null}
      title={editing ? editing.full_name : "New employee"}
      subtitle={editing?.employee_code}
      leading={editing && <Avatar name={editing.full_name} className="size-10 text-sm" />}
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
  const toast = useToast();
  const existing = target.mode === "edit" ? target.user : null;
  const [employeeCode, setEmployeeCode] = useState("");
  const [fullName, setFullName] = useState(existing?.full_name ?? "");
  const [password, setPassword] = useState("");
  const [level, setLevel] = useState<UserLevel>(existing?.level ?? "employee");
  const [departmentId, setDepartmentId] = useState(existing?.department_id ?? "");
  const [managerIds, setManagerIds] = useState<string[]>(existing?.manager_id ? [existing.manager_id] : []);
  const [status, setStatus] = useState<"active" | "disabled">(existing?.status ?? "active");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const firstField = useRef<HTMLInputElement>(null);

  // The owner is protected by the backend. Admins also cannot change their own role or status.
  const protectedAccount = existing !== null && (existing.org_role === "owner" || isSelf);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (existing) {
        const changes: UserChanges = {
          full_name: fullName.trim(),
          department_id: departmentId || null,
        };
        const manager = managerIds[0] ?? null;
        if (manager !== existing.manager_id) changes.manager_id = manager;
        if (!protectedAccount && level !== existing.level) {
          changes.level = level;
          changes.org_role = level === "admin" ? "admin" : "member";
        }
        if (!protectedAccount && status !== existing.status) changes.status = status;
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
          manager_id: managerIds[0] ?? null,
        });
        toast(`Employee ${user.employee_code} created.`);
        setEmployeeCode("");
        setFullName("");
        setPassword("");
        setLevel("employee");
        setDepartmentId("");
        setManagerIds([]);
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
        <FormSection title="Profile">
          <FormField label="Full name">
            <Input
              ref={existing ? undefined : firstField}
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              maxLength={200}
              required
            />
          </FormField>
          {existing ? (
            <FormField label="Employee code" hint="The code cannot be changed.">
              <Input value={existing.employee_code} readOnly disabled />
            </FormField>
          ) : (
            <>
              <FormField
                label="Employee code"
                hint="They sign in with this code. Leave it blank to take the next one (NV001, NV002, ...)."
              >
                <Input
                  value={employeeCode}
                  onChange={(event) => setEmployeeCode(event.target.value)}
                  placeholder="Auto"
                  maxLength={50}
                />
              </FormField>
              <FormField
                label="Initial password"
                hint="At least 8 characters. Tell it to the employee."
              >
                <PasswordInput label="Initial password" value={password} onChange={setPassword} required />
              </FormField>
            </>
          )}
        </FormSection>

        <FormSection title="Work">
          <FieldGroup
            label="Level"
            hint={protectedAccount ? "You cannot change this level." : undefined}
          >
            <LevelPicker value={level} onChange={setLevel} disabled={protectedAccount} />
          </FieldGroup>
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
          <FieldGroup label="Direct manager">
            <UserPicker
              label="Direct manager"
              value={managerIds}
              onChange={setManagerIds}
              multiple={false}
            />
          </FieldGroup>
        </FormSection>

        {existing && !protectedAccount && (
          <FormSection title="Account">
            <div className="flex items-center justify-between gap-2 text-sm">
              Account is
              <SegmentedControl
                label="Account status"
                options={STATUS_OPTIONS}
                value={status}
                onChange={setStatus}
              />
            </div>
            <p className="m-0 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
              Disabling signs them out everywhere at once.
            </p>
            <ResetPasswordSection userId={existing.id} startOpen={target.mode === "edit" && target.section === "password"} />
          </FormSection>
        )}

        <ErrorMessage error={error} />
      </DrawerBody>
      <DrawerFooter>
        <Button type="submit" variant="primary" loading={busy}>
          {existing ? "Save changes" : "Add employee"}
        </Button>
        <Button onClick={onClose} disabled={busy}>
          {existing ? "Cancel" : "Close"}
        </Button>
        {!existing && <span className="ml-auto text-xs text-muted">Stays open for the next one</span>}
      </DrawerFooter>
    </form>
  );
}

/**
 * For an employee who forgot their password: the admin sets a temporary one and tells it to them.
 * They are signed out everywhere and must choose their own at the next sign-in. It sits inside the
 * edit form, so it is not a form of its own, and Enter here must not save the form.
 */
function ResetPasswordSection({ userId, startOpen }: { userId: string; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
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

  if (!open) {
    return (
      <div className="flex items-center justify-between gap-2 text-sm">
        Forgot the password?
        <Button onClick={() => setOpen(true)}>Reset password…</Button>
      </div>
    );
  }

  return (
    <section aria-label="Reset password" className="grid gap-2">
      <FormField
        label="Reset password"
        hint="For someone who forgot it. They are signed out and must choose a new one at the next sign-in."
      >
        <PasswordInput
          label="Temporary password"
          value={password}
          onChange={setPassword}
          disabled={busy}
          placeholder="Temporary password"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (password.length >= 8 && !busy) void reset();
            }
          }}
        />
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
          Password reset. Tell the employee their temporary password: <strong>{doneWith}</strong>
        </Alert>
      )}
    </section>
  );
}
