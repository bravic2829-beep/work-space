"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useAuth } from "@/features/auth/AuthProvider";
import { ApiError } from "@/lib/api/client";

import { MembersPanel } from "./MembersPanel";
import { createBase, createTable, getWorkspace, listBases, listTables } from "./api";
import type { BaseItem, TableSummary, WorkspaceItem } from "./schema";

type Loaded = {
  workspace: WorkspaceItem;
  bases: { base: BaseItem; tables: TableSummary[] }[];
};

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: Loaded };

function message(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return "You do not have access to this workspace.";
    if (error.status === 404) return "This workspace does not exist.";
    return error.message;
  }
  return fallback;
}

/** One workspace: its bases and their tables, with forms to add more (editors and admins). */
export function WorkspaceScreen({ workspaceId }: { workspaceId: string }) {
  const { state: auth } = useAuth();
  const me = auth.status === "authenticated" ? auth.user.id : "";
  const [state, setState] = useState<State>({ kind: "loading" });
  const [reload, setReload] = useState(0);
  const [baseName, setBaseName] = useState("");
  const [tableNames, setTableNames] = useState<Record<string, string>>({});
  const [templates, setTemplates] = useState<Record<string, "blank" | "tasks">>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const workspace = await getWorkspace(workspaceId, controller.signal);
        const bases = await listBases(workspaceId, controller.signal);
        const withTables = await Promise.all(
          bases.map(async (base) => ({
            base,
            tables: await listTables(base.id, controller.signal),
          })),
        );
        setState({ kind: "ready", data: { workspace, bases: withTables } });
      } catch (caught) {
        if (controller.signal.aborted) return;
        setState({ kind: "error", message: message(caught, "Could not load the workspace.") });
      }
    }
    void load();
    return () => controller.abort();
  }, [workspaceId, reload]);

  if (state.kind === "loading") return <p role="status">Loading…</p>;
  if (state.kind === "error") {
    return (
      <p role="alert">
        {state.message}{" "}
        <button
          type="button"
          onClick={() => {
            setState({ kind: "loading" });
            setReload((n) => n + 1);
          }}
        >
          Try again
        </button>
      </p>
    );
  }

  const { workspace, bases } = state.data;
  const canEdit = workspace.my_role === "editor" || workspace.my_role === "admin";

  async function addBase(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await createBase(workspaceId, baseName.trim());
      setBaseName("");
      setReload((n) => n + 1);
    } catch (caught) {
      setError(message(caught, "Could not create the base."));
    }
  }

  async function addTable(event: React.FormEvent, baseId: string) {
    event.preventDefault();
    setError(null);
    try {
      await createTable(baseId, (tableNames[baseId] ?? "").trim(), templates[baseId] ?? "blank");
      setTableNames((current) => ({ ...current, [baseId]: "" }));
      setReload((n) => n + 1);
    } catch (caught) {
      setError(message(caught, "Could not create the table."));
    }
  }

  return (
    <section aria-labelledby="workspace-title">
      <p>
        <Link href="/workspaces">Workspaces</Link>
      </p>
      <h1 id="workspace-title">{workspace.name}</h1>
      {error && <p role="alert">{error}</p>}
      {bases.length === 0 && <p>No bases yet.</p>}
      {bases.map(({ base, tables }) => (
        <section key={base.id} aria-label={`Base ${base.name}`} className="base">
          <h2>{base.name}</h2>
          {tables.length === 0 ? (
            <p>No tables yet.</p>
          ) : (
            <ul className="plain">
              {tables.map((table) => (
                <li key={table.id}>
                  <Link href={`/tables/${table.id}`}>{table.name}</Link>
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <form
              onSubmit={(event) => void addTable(event, base.id)}
              className="inline-form"
              aria-label={`New table in ${base.name}`}
            >
              <input
                aria-label={`Table name in ${base.name}`}
                value={tableNames[base.id] ?? ""}
                onChange={(event) =>
                  setTableNames((current) => ({ ...current, [base.id]: event.target.value }))
                }
                maxLength={200}
                required
              />
              <select
                aria-label={`Template for the table in ${base.name}`}
                value={templates[base.id] ?? "blank"}
                onChange={(event) =>
                  setTemplates((current) => ({
                    ...current,
                    [base.id]: event.target.value === "tasks" ? "tasks" : "blank",
                  }))
                }
              >
                <option value="blank">Blank table</option>
                <option value="tasks">Tasks (assignee, status, due date, subtasks)</option>
              </select>
              <button type="submit" disabled={(tableNames[base.id] ?? "").trim() === ""}>
                Add table
              </button>
            </form>
          )}
        </section>
      ))}
      {canEdit && (
        <form onSubmit={(event) => void addBase(event)} className="inline-form" aria-label="New base">
          <input
            aria-label="Base name"
            value={baseName}
            onChange={(event) => setBaseName(event.target.value)}
            maxLength={200}
            required
          />
          <button type="submit" disabled={baseName.trim() === ""}>
            Add base
          </button>
        </form>
      )}
      {workspace.kind === "shared" && (
        <MembersPanel
          workspaceId={workspace.id}
          canManage={workspace.my_role === "admin"}
          currentUserId={me}
        />
      )}
    </section>
  );
}
