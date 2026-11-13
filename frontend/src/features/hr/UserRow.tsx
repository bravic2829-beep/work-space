"use client";

import { useState } from "react";

import { LEVEL_LABELS, type User, type UserLevel } from "@/features/auth/schema";

import { updateUser, type UserChanges } from "./api";
import { ErrorMessage } from "./ErrorMessage";
import type { Department } from "./schema";

const LEVELS = Object.keys(LEVEL_LABELS) as UserLevel[];

export function UserRow({
  user,
  departments,
  isSelf,
  onChanged,
}: {
  user: User;
  departments: Department[];
  isSelf: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(user.full_name);
  const [level, setLevel] = useState<UserLevel>(user.level);
  const [departmentId, setDepartmentId] = useState(user.department_id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const departmentName = departments.find((item) => item.id === user.department_id)?.name ?? "";
  // The owner is protected by the backend. Admins also cannot change their own role or status.
  const isOwner = user.org_role === "owner";

  async function apply(changes: UserChanges) {
    setBusy(true);
    setError(null);
    try {
      await updateUser(user.id, changes);
      setEditing(false);
      onChanged();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    const changes: UserChanges = {
      full_name: fullName.trim(),
      department_id: departmentId || null,
    };
    if (!isOwner && !isSelf && level !== user.level) {
      changes.level = level;
      changes.org_role = level === "admin" ? "admin" : "member";
    }
    void apply(changes);
  }

  if (editing) {
    return (
      <tr>
        <td colSpan={6}>
          <form onSubmit={save} className="form" aria-label={`Edit ${user.employee_code}`}>
            <label>
              Full name
              <input
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                maxLength={200}
                required
              />
            </label>
            <label>
              Level
              <select
                value={level}
                disabled={isOwner || isSelf}
                onChange={(event) => setLevel(event.target.value as UserLevel)}
              >
                {LEVELS.map((item) => (
                  <option key={item} value={item}>
                    {LEVEL_LABELS[item]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Department
              <select
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
              >
                <option value="">None</option>
                {departments.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <ErrorMessage error={error} />
            <div>
              <button type="submit" disabled={busy}>
                Save
              </button>{" "}
              <button type="button" onClick={() => setEditing(false)} disabled={busy}>
                Cancel
              </button>
            </div>
          </form>
        </td>
      </tr>
    );
  }

  return (
    <>
      <tr>
        <td>{user.employee_code}</td>
        <td>{user.full_name}</td>
        <td>{LEVEL_LABELS[user.level]}</td>
        <td>{departmentName}</td>
        <td>{user.status === "active" ? "Active" : "Disabled"}</td>
        <td>
          {!isOwner && (
            <>
              <button type="button" onClick={() => setEditing(true)} disabled={busy}>
                Edit
              </button>{" "}
              {!isSelf && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void apply({ status: user.status === "active" ? "disabled" : "active" })
                  }
                >
                  {user.status === "active" ? "Disable" : "Enable"}
                </button>
              )}
            </>
          )}
        </td>
      </tr>
      {error !== null && (
        <tr>
          <td colSpan={6}>
            <ErrorMessage error={error} />
          </td>
        </tr>
      )}
    </>
  );
}
