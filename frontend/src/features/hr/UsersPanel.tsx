"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/features/auth/AuthProvider";
import type { User } from "@/features/auth/schema";

import { listUsers, type UserFilters } from "./api";
import { CreateUserForm } from "./CreateUserForm";
import { ErrorMessage } from "./ErrorMessage";
import type { Department } from "./schema";
import { UserRow } from "./UserRow";

type ListState =
  | { kind: "loading" }
  | { kind: "error"; error: unknown }
  | { kind: "ready"; items: User[]; nextCursor: string | null };

const NO_FILTERS: UserFilters = { q: "", status: "" };

export function UsersPanel({ departments }: { departments: Department[] }) {
  const { state } = useAuth();
  const meId = state.status === "authenticated" ? state.user.id : null;

  const [draft, setDraft] = useState<UserFilters>(NO_FILTERS);
  const [filters, setFilters] = useState<UserFilters>(NO_FILTERS);
  const [reloadKey, setReloadKey] = useState(0);
  const [list, setList] = useState<ListState>({ kind: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<unknown>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const page = await listUsers(filters, null, controller.signal);
        setList({ kind: "ready", items: page.items, nextCursor: page.next_cursor });
      } catch (error) {
        if (controller.signal.aborted) return;
        setList({ kind: "error", error });
      }
    }

    void load();
    return () => controller.abort();
  }, [filters, reloadKey]);

  function reload() {
    setList({ kind: "loading" });
    setReloadKey((value) => value + 1);
  }

  function search(event: React.FormEvent) {
    event.preventDefault();
    setList({ kind: "loading" });
    setFilters({ q: draft.q.trim(), status: draft.status });
  }

  async function loadMore() {
    if (list.kind !== "ready" || !list.nextCursor) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await listUsers(filters, list.nextCursor);
      setList({
        kind: "ready",
        items: [...list.items, ...page.items],
        nextCursor: page.next_cursor,
      });
    } catch (error) {
      setMoreError(error);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section aria-labelledby="employees-title">
      <h2 id="employees-title">Employees</h2>

      <form onSubmit={search} className="form inline-form" aria-label="Search employees">
        <label>
          Search
          <input
            value={draft.q}
            onChange={(event) => setDraft({ ...draft, q: event.target.value })}
            placeholder="Code or name"
            maxLength={100}
          />
        </label>
        <label>
          Status
          <select
            value={draft.status}
            onChange={(event) =>
              setDraft({ ...draft, status: event.target.value as UserFilters["status"] })
            }
          >
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
        </label>
        <button type="submit">Search</button>
      </form>

      {list.kind === "loading" && <p role="status">Loading employees…</p>}
      {list.kind === "error" && <ErrorMessage error={list.error} />}
      {list.kind === "ready" && (
        <>
          {list.items.length === 0 ? (
            <p>No employees match.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Level</th>
                  <th>Department</th>
                  <th>Status</th>
                  <th>
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    departments={departments}
                    isSelf={user.id === meId}
                    onChanged={reload}
                  />
                ))}
              </tbody>
            </table>
          )}
          <ErrorMessage error={moreError} />
          {list.nextCursor && (
            <button type="button" onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </>
      )}

      <CreateUserForm departments={departments} onCreated={reload} />
    </section>
  );
}
