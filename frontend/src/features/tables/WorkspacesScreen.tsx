"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useAuth } from "@/features/auth/AuthProvider";
import { isOrgAdmin } from "@/features/auth/schema";
import { ApiError } from "@/lib/api/client";

import { createWorkspace, listWorkspaces } from "./api";
import type { WorkspaceItem } from "./schema";

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
          message: caught instanceof ApiError ? caught.message : "Could not load workspaces.",
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
      setError(caught instanceof ApiError ? caught.message : "Could not create the workspace.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="workspaces-title">
      <h1 id="workspaces-title">Workspaces</h1>
      {state.kind === "loading" && <p role="status">Loading…</p>}
      {state.kind === "error" && (
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
      )}
      {state.kind === "ready" && state.items.length === 0 && <p>You are not in any workspace yet.</p>}
      {state.kind === "ready" && state.items.length > 0 && (
        <ul className="plain">
          {state.items.map((workspace) => (
            <li key={workspace.id}>
              <Link href={`/workspaces/${workspace.id}`}>{workspace.name}</Link>{" "}
              <small>
                {workspace.kind === "personal" ? "personal" : "shared"} · {workspace.my_role}
              </small>
            </li>
          ))}
        </ul>
      )}
      {admin && (
        <form onSubmit={(event) => void create(event)} className="inline-form" aria-label="New workspace">
          <input
            aria-label="Workspace name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={200}
            required
          />
          <button type="submit" disabled={saving || name.trim() === ""}>
            Create workspace
          </button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
