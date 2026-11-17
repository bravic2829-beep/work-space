"use client";

import { Plus, UserX } from "lucide-react";
import { useEffect, useState } from "react";

import {
  Button,
  DataTable,
  EmptyState,
  ErrorMessage,
  LoadingState,
  SearchInput,
  SegmentedControl,
} from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import type { User } from "@/features/auth/schema";

import { listUsers, updateUser, type UserFilters } from "./api";
import type { Department } from "./schema";
import { UserDrawer, type UserDrawerTarget } from "./UserDrawer";
import { UserRow } from "./UserRow";

type ListState =
  | { kind: "loading" }
  | { kind: "error"; error: unknown }
  | { kind: "ready"; items: User[]; nextCursor: string | null };

const NO_FILTERS: UserFilters = { q: "", status: "" };
/** Wait for a pause in typing before asking the server, so each letter is not a request. */
const SEARCH_DELAY_MS = 300;

const STATUS_OPTIONS: { value: UserFilters["status"]; label: string }[] = [
  { value: "", label: "All" },
  { value: "active", label: "Active" },
  { value: "disabled", label: "Disabled" },
];

export function UsersPanel({ departments }: { departments: Department[] }) {
  const { state } = useAuth();
  const meId = state.status === "authenticated" ? state.user.id : null;

  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<UserFilters>(NO_FILTERS);
  const [reloadKey, setReloadKey] = useState(0);
  const [list, setList] = useState<ListState>({ kind: "loading" });
  // Rows stay on screen (dimmed) while a new search loads, instead of the table blinking away.
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<unknown>(null);
  const [rowError, setRowError] = useState<unknown>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [target, setTarget] = useState<UserDrawerTarget | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const page = await listUsers(filters, null, controller.signal);
        setList({ kind: "ready", items: page.items, nextCursor: page.next_cursor });
      } catch (error) {
        if (controller.signal.aborted) return;
        setList({ kind: "error", error });
      } finally {
        if (!controller.signal.aborted) setRefreshing(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [filters, reloadKey]);

  // Typing: apply the search after a short pause.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === filters.q) return;
    const timer = setTimeout(() => {
      setRefreshing(true);
      setFilters((current) => ({ ...current, q: trimmed }));
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query, filters.q]);

  function reload() {
    setRefreshing(true);
    setReloadKey((value) => value + 1);
  }

  function chooseStatus(status: UserFilters["status"]) {
    setRefreshing(true);
    setFilters((current) => ({ ...current, status }));
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

  async function setStatus(user: User, status: "active" | "disabled") {
    setBusyId(user.id);
    setRowError(null);
    try {
      await updateUser(user.id, { status });
      reload();
    } catch (error) {
      setRowError(error);
    } finally {
      setBusyId(null);
    }
  }

  const filtering = filters.q !== "" || filters.status !== "";
  // "50+" when there is another page behind "Load more".
  const countText =
    list.kind === "ready"
      ? `${list.items.length}${list.nextCursor ? "+" : ""} ${
          list.items.length === 1 && !list.nextCursor ? "employee" : "employees"
        }`
      : "";

  return (
    <section aria-label="Employees" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          aria-label="Search employees"
          placeholder="Search code or name…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          maxLength={100}
          className="w-72"
        />
        <SegmentedControl
          label="Status"
          options={STATUS_OPTIONS}
          value={filters.status}
          onChange={chooseStatus}
        />
        <div className="ml-auto flex items-center gap-3">
          {countText && <span className="font-mono text-xs text-muted">{countText}</span>}
          <Button
            variant="primary"
            size="sm"
            icon={Plus}
            onClick={() => setTarget({ mode: "create" })}
          >
            New employee
          </Button>
        </div>
      </div>

      <ErrorMessage error={rowError} />

      {list.kind === "loading" && <LoadingState>Loading employees…</LoadingState>}
      {list.kind === "error" && <ErrorMessage error={list.error} />}
      {list.kind === "ready" && (
        <>
          {list.items.length === 0 ? (
            <EmptyState icon={UserX} title={filtering ? "No employees match." : "No employees yet."}>
              {filtering ? "Try a different search or status." : "Add the first employee with “New employee”."}
            </EmptyState>
          ) : (
            <div className={refreshing ? "opacity-60 transition-opacity" : "transition-opacity"}>
              <DataTable dense aria-label="Employees">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Level</th>
                    <th>Department</th>
                    <th>Status</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.items.map((user) => (
                    <UserRow
                      key={user.id}
                      user={user}
                      departmentName={departments.find((d) => d.id === user.department_id)?.name ?? ""}
                      isSelf={user.id === meId}
                      selected={target?.mode === "edit" && target.user.id === user.id}
                      busy={busyId === user.id}
                      onEdit={() => setTarget({ mode: "edit", user })}
                      onSetStatus={(status) => void setStatus(user, status)}
                    />
                  ))}
                </tbody>
              </DataTable>
            </div>
          )}
          <ErrorMessage error={moreError} />
          {list.nextCursor && (
            <div>
              <Button onClick={() => void loadMore()} loading={loadingMore}>
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}

      <UserDrawer
        target={target}
        departments={departments}
        meId={meId}
        onClose={() => setTarget(null)}
        onCreated={reload}
        onSaved={() => {
          setTarget(null);
          reload();
        }}
      />
    </section>
  );
}
