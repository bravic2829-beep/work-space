"use client";

import { useEffect, useState } from "react";

import { Alert, Button, Card, Input, Select } from "@/components/ui";

import { addMember, changeMemberRole, listMembers, removeMember, searchDirectory } from "./api";
import type { DirectoryUser, MemberItem, Role } from "./schema";
import { errorMessage } from "@/lib/api/errors";

const ROLES: Role[] = ["viewer", "commenter", "editor", "admin"];

const ROLE_LABELS: Record<Role, string> = {
  viewer: "Viewer",
  commenter: "Commenter",
  editor: "Editor",
  admin: "Admin",
};

type Props = {
  workspaceId: string;
  /** Only a workspace admin may add, change or remove members (the server checks it too). */
  canManage: boolean;
  currentUserId: string;
};

/** Who is in the workspace and with which role; admins of the workspace can change that. */
export function MembersPanel({ workspaceId, canManage, currentUserId }: Props) {
  const [members, setMembers] = useState<MemberItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DirectoryUser[]>([]);
  const [newRole, setNewRole] = useState<Role>("editor");

  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const list = await listMembers(workspaceId, controller.signal);
        setMembers(list);
        setLoadError(null);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setLoadError(errorMessage(caught, "Could not load the members."));
      }
    }
    void load();
    return () => controller.abort();
  }, [workspaceId, reload]);

  useEffect(() => {
    if (!canManage || query.trim() === "") return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        setResults(await searchDirectory(query.trim(), controller.signal));
      } catch {
        if (!controller.signal.aborted) setResults([]);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, canManage]);

  async function change(action: () => Promise<unknown>, fallback: string) {
    setError(null);
    setBusy(true);
    try {
      await action();
      setReload((n) => n + 1);
    } catch (caught) {
      setError(errorMessage(caught, fallback));
    } finally {
      setBusy(false);
    }
  }

  const memberIds = new Set((members ?? []).map((m) => m.user_id));
  const candidates = results.filter((user) => !memberIds.has(user.id));

  return (
    <Card aria-label="Members" className="grid gap-3">
      <h2 className="m-0 text-base font-semibold">Members</h2>
      {loadError && <Alert>{loadError}</Alert>}
      {members === null && !loadError && <p role="status">Loading members…</p>}
      {members && (
        <ul className="m-0 grid list-none gap-2 p-0" aria-label="Workspace members">
          {members.map((member) => (
            <li key={member.user_id} className="flex flex-wrap items-center gap-2">
              <span className="min-w-48 flex-1 text-sm">
                {member.full_name} <span className="text-muted">({member.employee_code})</span>
              </span>
              {canManage ? (
                <>
                  <Select
                    aria-label={`Role of ${member.full_name}`}
                    className="w-auto"
                    value={member.role}
                    disabled={busy}
                    onChange={(event) =>
                      void change(
                        () =>
                          changeMemberRole(workspaceId, member.user_id, event.target.value as Role),
                        "Could not change the role.",
                      )
                    }
                  >
                    {ROLES.map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </option>
                    ))}
                  </Select>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    aria-label={`Remove ${member.full_name}`}
                    onClick={() =>
                      void change(
                        () => removeMember(workspaceId, member.user_id),
                        "Could not remove the member.",
                      )
                    }
                  >
                    {member.user_id === currentUserId ? "Leave" : "Remove"}
                  </Button>
                </>
              ) : (
                <span className="text-sm text-muted">{ROLE_LABELS[member.role]}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <Alert>{error}</Alert>}

      {canManage && (
        <div className="grid gap-2 border-t border-line pt-3">
          <p className="m-0 text-sm font-medium">Add a member</p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="search"
              className="w-auto min-w-48 flex-1"
              aria-label="Find an employee to add"
              placeholder="Search by name or code"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Select
              aria-label="Role of the new member"
              className="w-auto"
              value={newRole}
              onChange={(event) => setNewRole(event.target.value as Role)}
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </Select>
          </div>
          {query.trim() !== "" && (
            <ul className="m-0 grid list-none gap-1 p-0" aria-label="Employees found">
              {candidates.map((user) => (
                <li key={user.id}>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void change(async () => {
                        await addMember(workspaceId, user.id, newRole);
                        setQuery("");
                        setResults([]);
                      }, "Could not add the member.")
                    }
                  >
                    Add {user.full_name} ({user.employee_code})
                  </Button>
                </li>
              ))}
              {candidates.length === 0 && <li className="text-sm text-muted">No one to add.</li>}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
