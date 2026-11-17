"use client";

import {
  Building2,
  ChevronDown,
  ChevronRight,
  Layers,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  ErrorMessage,
  InlineConfirm,
  Menu,
  SearchInput,
  type MenuItem,
} from "@/components/ui";

import { deleteDepartment } from "./api";
import { DepartmentDrawer, type DepartmentDrawerTarget } from "./DepartmentDrawer";
import { orderDepartments } from "./departmentTree";
import { PersonLabel } from "./PersonLabel";
import type { Department } from "./schema";

export function DepartmentsPanel({
  departments,
  onChanged,
  onShowPeople,
}: {
  departments: Department[];
  onChanged: () => void;
  /** Open the Employees tab narrowed to this department. */
  onShowPeople: (departmentId: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const [target, setTarget] = useState<DepartmentDrawerTarget | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const rows = useMemo(() => orderDepartments(departments), [departments]);
  const needle = filter.trim().toLowerCase();
  const visible = rows.filter(({ item, depth }) => {
    if (needle) {
      const parent = departments.find((d) => d.id === item.parent_id);
      return (
        item.name.toLowerCase().includes(needle) ||
        (parent?.name.toLowerCase().includes(needle) ?? false)
      );
    }
    // A folded division hides the departments under it (a search shows everything it finds).
    return depth === 0 || !collapsed.has(item.parent_id ?? "");
  });
  const divisionIds = departments.filter((d) => d.kind === "division").map((d) => d.id);
  const people = departments.reduce((sum, d) => sum + d.member_count, 0);

  function peopleOf(item: Department): number {
    if (item.kind !== "division") return item.member_count;
    // A division counts the people of the departments under it too.
    return departments
      .filter((d) => d.parent_id === item.id)
      .reduce((sum, d) => sum + d.member_count, item.member_count);
  }

  function toggle(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function remove(item: Department) {
    setBusy(true);
    setError(null);
    try {
      await deleteDepartment(item.id);
      onChanged();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  function actionsOf(item: Department): MenuItem[] {
    const children = departments.some((d) => d.parent_id === item.id);
    const reason = children
      ? "It still has departments under it."
      : item.member_count > 0
        ? `It still has ${item.member_count} ${item.member_count === 1 ? "employee" : "employees"}.`
        : undefined;
    return [
      { label: "Edit", icon: Pencil, onSelect: () => setTarget({ mode: "edit", department: item }) },
      ...(item.kind === "division"
        ? []
        : [{ label: "Show people", icon: Users, onSelect: () => onShowPeople(item.id) }]),
      {
        label: "Delete…",
        icon: Trash2,
        onSelect: () => setDeleting(item.id),
        disabled: reason !== undefined,
        hint: reason,
      },
    ];
  }

  return (
    <section aria-label="Departments" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          aria-label="Filter departments"
          placeholder="Filter departments…"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          className="w-56"
        />
        {divisionIds.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setCollapsed(collapsed.size > 0 ? new Set() : new Set(divisionIds))}
          >
            {collapsed.size > 0 ? "Expand all" : "Collapse all"}
          </Button>
        )}
        <div className="ml-auto flex items-center gap-3">
          <span className="font-mono text-xs text-muted">
            {departments.length} {departments.length === 1 ? "department" : "departments"} ·{" "}
            {people} {people === 1 ? "person" : "people"}
          </span>
          <Button
            variant="primary"
            size="sm"
            icon={Plus}
            onClick={() => setTarget({ mode: "create" })}
          >
            New department
          </Button>
        </div>
      </div>

      <ErrorMessage error={error} />

      {departments.length === 0 ? (
        <EmptyState icon={Building2} title="No departments yet.">
          Start with a division for the big groups, or add departments directly.
        </EmptyState>
      ) : visible.length === 0 ? (
        <EmptyState icon={Search} title="No department matches.">
          Try a different name.
        </EmptyState>
      ) : (
        <DataTable dense aria-label="Departments">
          <thead>
            <tr>
              <th>Department</th>
              <th>Head</th>
              <th>People</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ item, depth }) => {
              const isDivision = item.kind === "division";
              const count = peopleOf(item);
              return (
                <tr
                  key={item.id}
                  className="cursor-pointer"
                  onClick={() => setTarget({ mode: "edit", department: item })}
                >
                  <td>
                    <span
                      className={
                        depth === 1
                          ? "inline-flex items-center gap-1.5 pl-6"
                          : "inline-flex items-center gap-1.5 font-semibold"
                      }
                    >
                      {isDivision && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-5"
                          aria-label={`${collapsed.has(item.id) ? "Expand" : "Collapse"} ${item.name}`}
                          aria-expanded={!collapsed.has(item.id)}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggle(item.id);
                          }}
                        >
                          {collapsed.has(item.id) ? (
                            <ChevronRight className="size-3.5" aria-hidden />
                          ) : (
                            <ChevronDown className="size-3.5" aria-hidden />
                          )}
                        </Button>
                      )}
                      {isDivision && <Layers className="size-3.5 text-secondary" aria-hidden />}
                      {item.name}
                      {isDivision && <Badge tone="info">Division</Badge>}
                    </span>
                  </td>
                  <td>
                    <PersonLabel userId={item.head_user_id} />
                  </td>
                  <td className="font-mono text-xs" onClick={(event) => event.stopPropagation()}>
                    {!isDivision && count > 0 ? (
                      <button
                        type="button"
                        className="h-auto border-0 bg-transparent p-0 font-mono text-xs font-normal text-primary hover:bg-transparent hover:underline"
                        aria-label={`Show the ${count} ${count === 1 ? "person" : "people"} in ${item.name}`}
                        onClick={() => onShowPeople(item.id)}
                      >
                        {count} →
                      </button>
                    ) : (
                      <span
                        className={count === 0 ? "text-muted" : undefined}
                        title={isDivision ? "Including its departments" : undefined}
                      >
                        {count}
                      </span>
                    )}
                  </td>
                  <td
                    className="text-right whitespace-nowrap"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <span className="inline-flex items-center justify-end gap-1.5">
                      <InlineConfirm
                        open={deleting === item.id}
                        onOpenChange={(open) => setDeleting(open ? item.id : null)}
                        hideTrigger
                        label="Delete"
                        prompt={`Delete ${item.name}?`}
                        confirmLabel="Yes, delete"
                        disabled={busy}
                        onConfirm={() => void remove(item)}
                      />
                      {deleting !== item.id && (
                        <Menu
                          trigger={
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-7"
                              disabled={busy}
                              aria-label={`Actions for ${item.name}`}
                            >
                              <MoreHorizontal className="size-4" aria-hidden />
                            </Button>
                          }
                          items={actionsOf(item)}
                        />
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      )}

      <DepartmentDrawer
        target={target}
        departments={departments}
        onClose={() => setTarget(null)}
        onCreated={onChanged}
        onSaved={() => {
          setTarget(null);
          onChanged();
        }}
      />
    </section>
  );
}
