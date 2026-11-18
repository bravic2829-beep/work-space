"use client";

import { ChevronRight, Table2, User } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { listSheets } from "@/features/sheets/api";
import { cn } from "@/lib/cn";
import { useApiResource } from "@/lib/useApiResource";

import { listBases, listTables, listWorkspaces } from "./api";
import type { TableSummary, WorkspaceItem } from "./schema";

const HEADING = "px-2.5 py-1 text-[11px] font-medium tracking-wider text-muted uppercase";
const ROW =
  "flex min-w-0 items-center gap-1.5 rounded px-2 py-1 text-[13px] no-underline hover:bg-primary-soft/60 hover:text-fg hover:no-underline";

function TableLink({ id, name }: { id: string; name: string }) {
  const pathname = usePathname() ?? "";
  const active = pathname === `/tables/${id}`;
  return (
    <Link
      href={`/tables/${id}`}
      aria-current={active ? "page" : undefined}
      className={cn(ROW, "pl-7", active ? "bg-primary-soft font-semibold text-primary" : "text-muted")}
    >
      <Table2 className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{name}</span>
    </Link>
  );
}

/** One workspace: its name opens the page, the arrow lists its tables (read when first opened). */
function WorkspaceBranch({ workspace }: { workspace: WorkspaceItem }) {
  const [open, setOpen] = useState(false);
  const [tables, setTables] = useState<TableSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open || tables !== null) return;
    const controller = new AbortController();
    async function load() {
      try {
        const bases = await listBases(workspace.id, controller.signal);
        const lists = await Promise.all(bases.map((b) => listTables(b.id, controller.signal)));
        setTables(lists.flat());
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    }
    void load();
    return () => controller.abort();
  }, [open, tables, workspace.id]);

  const Icon = workspace.kind === "personal" ? User : null;
  return (
    <li className="flex flex-col">
      <div className="flex items-center">
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? "Hide" : "Show"} the tables of ${workspace.name}`}
          className="flex size-6 shrink-0 items-center justify-center border-0 bg-transparent p-0 text-muted hover:bg-transparent hover:text-fg"
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} aria-hidden />
        </button>
        <Link href={`/workspaces/${workspace.id}`} className={cn(ROW, "flex-1 text-fg")}>
          {Icon && <Icon className="size-3.5 shrink-0 text-muted" aria-hidden />}
          <span className="truncate">{workspace.name}</span>
        </Link>
      </div>
      {open && (
        <ul className="m-0 flex list-none flex-col p-0">
          {tables === null && !failed && <li className="py-1 pl-7 text-xs text-muted">Loading…</li>}
          {failed && <li className="py-1 pl-7 text-xs text-muted">Could not load.</li>}
          {tables?.length === 0 && <li className="py-1 pl-7 text-xs text-muted">No tables yet.</li>}
          {tables?.map((t) => (
            <li key={t.id}>
              <TableLink id={t.id} name={t.name} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The workspaces of the person with their tables, and, apart, the tables they only reach through a
 * sheet someone shared ("Shared with me"). Nothing shows while the lists load or if they fail:
 * the rest of the navigation does not depend on it.
 */
export function SidebarTree() {
  const workspaces = useApiResource(listWorkspaces, "", []);
  const sheets = useApiResource(listSheets, "", []);

  const shared = useMemo(() => {
    if (sheets.kind !== "ready") return [];
    const seen = new Map<string, string>();
    // A sheet that does not let the person see every task means they are not in the workspace.
    for (const s of sheets.data) {
      if (!s.can_see_all && !seen.has(s.table_id)) seen.set(s.table_id, s.table_name);
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [sheets]);

  const list = workspaces.kind === "ready" ? workspaces.data : [];
  if (list.length === 0 && shared.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {list.length > 0 && (
        <nav aria-label="Workspace tree" className="flex flex-col gap-0.5">
          <span className={HEADING}>Workspaces</span>
          <ul className="m-0 flex list-none flex-col p-0">
            {list.map((w) => (
              <WorkspaceBranch key={w.id} workspace={w} />
            ))}
          </ul>
        </nav>
      )}
      {shared.length > 0 && (
        <nav aria-label="Shared with me" className="flex flex-col gap-0.5">
          <span className={HEADING}>Shared with me</span>
          <ul className="m-0 flex list-none flex-col p-0">
            {shared.map((t) => (
              <li key={t.id}>
                <TableLink id={t.id} name={t.name} />
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
