"use client";

import { Database, Plus, ShieldCheck, Table2, User, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  LoadingState,
  Select,
} from "@/components/ui";
import { usePageCrumb } from "@/components/Breadcrumb";
import { useAuth } from "@/features/auth/AuthProvider";
import { ApiError } from "@/lib/api/client";

import { MembersPanel } from "./MembersPanel";
import { createBase, createTable, getWorkspace, listBases, listTables } from "./api";
import type { BaseItem, Role, TableSummary, WorkspaceItem } from "./schema";

type Loaded = {
  workspace: WorkspaceItem;
  bases: { base: BaseItem; tables: TableSummary[] }[];
};

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: Loaded };

const KIND_HINT = {
  shared: "A shared workspace. Every invited member can see the tables inside.",
  personal: "Your personal workspace. Only you can see it.",
};

const ROLE_HINT: Record<Role, string> = {
  viewer: "You can view this workspace but not change it.",
  commenter: "You can view and comment, but not edit.",
  editor: "You can add and edit bases and tables.",
  admin: "You can rename, invite members, change roles and delete this workspace.",
};

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
  // The forms to add a table or a base stay folded away until asked for.
  const [addingTableTo, setAddingTableTo] = useState<string | null>(null);
  const [addingBase, setAddingBase] = useState(false);

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

  usePageCrumb(state.kind === "ready" ? state.data.workspace.name : null);

  if (state.kind === "loading") return <LoadingState>Loading…</LoadingState>;
  if (state.kind === "error") {
    return (
      <Alert>
        <span className="mr-2">{state.message}</span>
        <Button
          size="sm"
          onClick={() => {
            setState({ kind: "loading" });
            setReload((n) => n + 1);
          }}
        >
          Try again
        </Button>
      </Alert>
    );
  }

  const { workspace, bases } = state.data;
  const canEdit = workspace.my_role === "editor" || workspace.my_role === "admin";
  const shared = workspace.kind === "shared";

  async function addBase(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await createBase(workspaceId, baseName.trim());
      setBaseName("");
      setAddingBase(false);
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
      setAddingTableTo(null);
      setReload((n) => n + 1);
    } catch (caught) {
      setError(message(caught, "Could not create the table."));
    }
  }

  return (
    <section aria-labelledby="workspace-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 id="workspace-title" className="m-0">
          {workspace.name}
        </h1>
        <Badge tone="neutral" className="gap-1" title={shared ? KIND_HINT.shared : KIND_HINT.personal}>
          {shared ? <Users className="size-3" aria-hidden /> : <User className="size-3" aria-hidden />}
          {shared ? "shared" : "personal"}
        </Badge>
        <Badge tone="info" className="gap-1" title={ROLE_HINT[workspace.my_role]}>
          <ShieldCheck className="size-3" aria-hidden />
          {workspace.my_role}
        </Badge>
      </div>

      {error && <Alert>{error}</Alert>}

      <div className={shared ? "grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]" : "grid gap-4"}>
        <div className="flex flex-col gap-3">
          {bases.length === 0 && (
            <EmptyState icon={Database} title="No bases yet.">
              A base groups related tables, for example one per project or team.
            </EmptyState>
          )}
          {bases.map(({ base, tables }) => (
            <Card key={base.id} flush aria-label={`Base ${base.name}`} className="flex flex-col gap-3">
              <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
                <Database className="size-4 text-secondary" aria-hidden />
                <h2 className="m-0 text-base">{base.name}</h2>
                <span className="font-mono text-xs text-muted">{tables.length}</span>
              </div>
              <div className="flex flex-col gap-3 px-4 pb-4">
                {tables.length === 0 ? (
                  <p className="m-0 text-sm text-muted">No tables yet.</p>
                ) : (
                  <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-2 p-0">
                    {tables.map((table) => (
                      <li key={table.id}>
                        <Link
                          href={`/tables/${table.id}`}
                          className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium text-fg no-underline transition-colors hover:border-primary hover:bg-primary-soft hover:no-underline"
                        >
                          <Table2 className="size-4 shrink-0 text-primary" aria-hidden />
                          <span className="truncate">{table.name}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                {canEdit && addingTableTo !== base.id && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={Plus}
                    className="self-start text-primary"
                    onClick={() => setAddingTableTo(base.id)}
                  >
                    New table
                  </Button>
                )}
                {canEdit && addingTableTo === base.id && (
                  <form
                    onSubmit={(event) => void addTable(event, base.id)}
                    className="flex flex-wrap items-center gap-1.5"
                    aria-label={`New table in ${base.name}`}
                  >
                    <Input
                      aria-label={`Table name in ${base.name}`}
                      placeholder="New table…"
                      className="h-7 w-48 py-0 text-[13px]"
                      value={tableNames[base.id] ?? ""}
                      onChange={(event) =>
                        setTableNames((current) => ({ ...current, [base.id]: event.target.value }))
                      }
                      maxLength={200}
                      required
                      autoFocus
                    />
                    <Select
                      aria-label={`Template for the table in ${base.name}`}
                      className="h-7 w-auto py-0 text-[13px]"
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
                    </Select>
                    <Button
                      type="submit"
                      size="sm"
                      icon={Plus}
                      disabled={(tableNames[base.id] ?? "").trim() === ""}
                    >
                      Add table
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setAddingTableTo(null)}>
                      Cancel
                    </Button>
                  </form>
                )}
              </div>
            </Card>
          ))}
          {canEdit && !addingBase && (
            <Button
              size="sm"
              variant="ghost"
              icon={Plus}
              className="self-start text-primary"
              onClick={() => setAddingBase(true)}
            >
              New base
            </Button>
          )}
          {canEdit && addingBase && (
            <form
              onSubmit={(event) => void addBase(event)}
              className="flex flex-wrap items-center gap-1.5 rounded-lg border border-dashed border-line-strong p-3"
              aria-label="New base"
            >
              <Input
                aria-label="Base name"
                placeholder="New base…"
                className="h-7 w-56 py-0 text-[13px]"
                value={baseName}
                onChange={(event) => setBaseName(event.target.value)}
                maxLength={200}
                required
                autoFocus
              />
              <Button type="submit" size="sm" icon={Plus} disabled={baseName.trim() === ""}>
                Add base
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAddingBase(false)}>
                Cancel
              </Button>
            </form>
          )}
        </div>
        {shared && (
          <MembersPanel
            workspaceId={workspace.id}
            canManage={workspace.my_role === "admin"}
            currentUserId={me}
          />
        )}
      </div>
    </section>
  );
}
