"use client";

import { useState } from "react";

import { LEVEL_LABELS, type UserLevel } from "@/features/auth/schema";

import { createUser } from "./api";
import { ErrorMessage } from "./ErrorMessage";
import type { Department } from "./schema";

const LEVELS = Object.keys(LEVEL_LABELS) as UserLevel[];

export function CreateUserForm({
  departments,
  onCreated,
}: {
  departments: Department[];
  onCreated: () => void;
}) {
  const [employeeCode, setEmployeeCode] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [level, setLevel] = useState<UserLevel>("employee");
  const [departmentId, setDepartmentId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setCreated(null);
    try {
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
    } catch (caught) {
      setError(caught);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="form" aria-label="Add employee">
      <h3>Add employee</h3>
      <label>
        Employee code
        <input
          value={employeeCode}
          onChange={(event) => setEmployeeCode(event.target.value)}
          maxLength={50}
          required
        />
      </label>
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
        Initial password
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          required
        />
      </label>
      <label>
        Level
        <select value={level} onChange={(event) => setLevel(event.target.value as UserLevel)}>
          {LEVELS.map((item) => (
            <option key={item} value={item}>
              {LEVEL_LABELS[item]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Department
        <select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
          <option value="">None</option>
          {departments.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <ErrorMessage error={error} />
      {created && <p role="status">Employee {created} created.</p>}
      <button type="submit" disabled={submitting}>
        {submitting ? "Adding…" : "Add employee"}
      </button>
    </form>
  );
}
