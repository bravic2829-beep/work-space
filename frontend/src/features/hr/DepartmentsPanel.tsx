"use client";

import { useState } from "react";

import { UserPicker } from "@/features/tables/UserPicker";

import { createDepartment, deleteDepartment, setDepartmentHead } from "./api";
import { ErrorMessage } from "./ErrorMessage";
import type { Department, DepartmentKind } from "./schema";

export function DepartmentsPanel({
  departments,
  onChanged,
}: {
  departments: Department[];
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<DepartmentKind>("division");
  const [parentId, setParentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const divisions = departments.filter((item) => item.kind === "division");

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createDepartment({
        name: name.trim(),
        kind,
        // Only a department can sit under a division.
        parent_id: kind === "department" && parentId ? parentId : null,
      });
      setName("");
      setParentId("");
      onChanged();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function changeHead(department: Department, ids: string[]) {
    setBusy(true);
    setError(null);
    try {
      await setDepartmentHead(department.id, ids[0] ?? null);
      onChanged();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function remove(department: Department) {
    if (!window.confirm(`Delete "${department.name}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteDepartment(department.id);
      onChanged();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="departments-title">
      <h2 id="departments-title">Departments</h2>

      {departments.length === 0 ? (
        <p>No departments yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Under</th>
              <th>Head</th>
              <th>
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {departments.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>{item.kind === "division" ? "Division" : "Department"}</td>
                <td>{departments.find((parent) => parent.id === item.parent_id)?.name ?? ""}</td>
                <td>
                  <UserPicker
                    label={`Head of ${item.name}`}
                    value={item.head_user_id ? [item.head_user_id] : []}
                    onChange={(ids) => void changeHead(item, ids)}
                    multiple={false}
                    disabled={busy}
                  />
                </td>
                <td>
                  <button type="button" disabled={busy} onClick={() => void remove(item)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form onSubmit={add} className="form" aria-label="Add department">
        <h3>Add department</h3>
        <label>
          Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={200}
            required
          />
        </label>
        <label>
          Type
          <select value={kind} onChange={(event) => setKind(event.target.value as DepartmentKind)}>
            <option value="division">Division</option>
            <option value="department">Department</option>
          </select>
        </label>
        {kind === "department" && (
          <label>
            Under division
            <select value={parentId} onChange={(event) => setParentId(event.target.value)}>
              <option value="">None</option>
              {divisions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <ErrorMessage error={error} />
        <button type="submit" disabled={busy}>
          Add department
        </button>
      </form>
    </section>
  );
}
