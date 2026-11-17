"use client";

import { FolderKanban, FolderOpen, Plus, User } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Input,
  LinkCard,
  LoadingState,
  PageHeader,
} from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { isOrgAdmin } from "@/features/auth/schema";

import { createWorkspace, listWorkspaces } from "./api";
import type { WorkspaceItem } from "./schema";
import { errorMessage } from "@/lib/api/errors";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; items: WorkspaceItem[] };

/** The workspaces the person belongs to. Admins can also make a shared workspace. */
export function WorkspacesScreen() {
  const { state: auth } = useAuth();
  const admin = auth.status === "authenticated" && isOrgAdmin(auth.user);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [reload, setReload] = useState(0);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        setState({ kind: "ready", items: await listWorkspaces(controller.signal) });
      } catch (caught) {
        if (controller.signal.aborted) return;
        setState({
          kind: "error",
          message: errorMessage(caught, "Could not load workspaces."),
        });
      }
    }
    void load();
    return () => controller.abort();
  }, [reload]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await createWorkspace(name.trim());
      setName("");
      setReload((n) => n + 1);
    } catch (caught) {
      setError(errorMessage(caught, "Could not create the workspace."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="workspaces-title" className="flex flex-col gap-4">
      <PageHeader
        title="Workspaces"
        description="Where your bases and tables live. Open one to see its tables and members."
        className="mb-0"
        actions={
          admin ? (
            <form
              onSubmit={(event) => void create(event)}
              className="flex items-center gap-1.5"
              aria-label="New workspace"
            >
              <Input
                aria-label="Workspace name"
                placeholder="New shared workspace…"
                className="h-7 w-56 py-0 text-[13px]"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={200}
                required
              />
              <Button
                type="submit"
                variant="primary"
                size="sm"
                icon={Plus}
                disabled={saving || name.trim() === ""}
              >
                Create workspace
              </Button>
            </form>
          ) : undefined
        }
      />
      {error && <Alert>{error}</Alert>}
      {state.kind === "loading" && <LoadingState />}
      {state.kind === "error" && (
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
      )}
      {state.kind === "ready" && state.items.length === 0 && (
        <EmptyState icon={FolderOpen} title="You are not in any workspace yet.">
          Ask an administrator to add you to one.
        </EmptyState>
      )}
      {state.kind === "ready" && state.items.length > 0 && (
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3 p-0">
          {state.items.map((workspace) => {
            const Icon = workspace.kind === "personal" ? User : FolderKanban;
            return (
              <LinkCard key={workspace.id} className="items-start rounded-lg p-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded bg-primary-soft text-primary">
                  <Icon className="size-4.5" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-col gap-1">
                  {/* The whole card is the link: the ::after stretches it over the card. */}
                  <Link
                    href={`/workspaces/${workspace.id}`}
                    className="truncate font-semibold text-fg no-underline after:absolute after:inset-0 hover:no-underline"
                  >
                    {workspace.name}
                  </Link>
                  <small className="flex items-center gap-1.5">
                    <Badge tone={workspace.kind === "personal" ? "neutral" : "info"}>
                      {workspace.kind === "personal" ? "personal" : "shared"} · {workspace.my_role}
                    </Badge>
                  </small>
                </span>
              </LinkCard>
            );
          })}
        </ul>
      )}
    </section>
  );
}
