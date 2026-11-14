"use client";

import { Building2, CornerDownRight, Layers, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge, Button, DataTable, EmptyState, Input } from "@/components/ui";

import { deleteDepartment, setDepartmentHead } from "./api";
import { DepartmentDrawer } from "./DepartmentDrawer";
import { orderDepartments } from "./departmentTree";
import { ErrorMessage } from "./ErrorMessage";
import { HeadCell } from "./HeadCell";
import { InlineConfirm } from "./InlineConfirm";
import type { Department } from "./schema";

export function DepartmentsPanel({
  departments,
  onChanged,
}: {
  departments: Department[];
  onChanged: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const rows = useMemo(() => orderDepartments(departments), [departments]);
  const needle = filter.trim().toLowerCase();
  const visible = needle
    ? rows.filter(({ item }) => {
        const parent = departments.find((d) => d.id === item.parent_id);
        return (
          item.name.toLowerCase().includes(needle) || (parent?.name.toLowerCase().includes(needle) ?? false)
        );
      })
    : rows;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Departments" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <Input
            type="search"
            aria-label="Filter departments"
            placeholder="Filter departments…"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="h-7 w-56 pl-7 text-[13px]"
          />
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="font-mono text-xs text-muted">
            {visible.length} of {departments.length}
          </span>
          <Button variant="primary" size="sm" icon={Plus} onClick={() => setDrawerOpen(true)}>
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
              <th>Name</th>
              <th>Type</th>
              <th>Under</th>
              <th>Head</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ item, depth }) => {
              const parent = departments.find((d) => d.id === item.parent_id);
              return (
                <tr key={item.id}>
                  <td>
                    <span
                      className={
                        depth === 1
                          ? "inline-flex items-center gap-1.5 pl-5"
                          : "inline-flex items-center gap-1.5 font-semibold"
                      }
                    >
                      {depth === 1 ? (
                        <CornerDownRight className="size-3.5 text-line-strong" aria-hidden />
                      ) : (
                        item.kind === "division" && (
                          <Layers className="size-3.5 text-secondary" aria-hidden />
                        )
                      )}
                      {item.name}
                    </span>
                  </td>
                  <td>
                    <Badge tone={item.kind === "division" ? "info" : "neutral"}>
                      {item.kind === "division" ? "Division" : "Department"}
                    </Badge>
                  </td>
                  <td className="text-muted">{parent?.name ?? "—"}</td>
                  <td>
                    <HeadCell
                      department={item.name}
                      headId={item.head_user_id}
                      disabled={busy}
                      onChange={(headId) => void run(() => setDepartmentHead(item.id, headId))}
                    />
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <InlineConfirm
                      label="Delete"
                      prompt={`Delete ${item.name}?`}
                      confirmLabel="Yes, delete"
                      disabled={busy}
                      onConfirm={() => void run(() => deleteDepartment(item.id))}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      )}

      <DepartmentDrawer
        open={drawerOpen}
        departments={departments}
        onClose={() => setDrawerOpen(false)}
        onCreated={onChanged}
      />
    </section>
  );
}
