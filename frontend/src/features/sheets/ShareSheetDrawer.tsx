"use client";

import { Archive, Check, Minus, UserPlus, X } from "lucide-react";
import { useCallback, useState } from "react";

import {
  Alert,
  Badge,
  Button,
  Drawer,
  DrawerBody,
  InlineConfirm,
  Input,
  LoadingState,
  PersonIdentity,
  PersonRow,
  Select,
} from "@/components/ui";
import { UserPicker } from "@/features/tables/UserPicker";

import {
  archiveSheet,
  listSheetMembers,
  removeSheetMember,
  renameSheet,
  setSheetMember,
} from "./api";
import {
  SHEET_ROLE_LABELS,
  SHEET_ROLES,
  type SheetItem,
  type SheetRole,
} from "./schema";
import { errorMessage } from "@/lib/api/errors";
import { useApiResource } from "@/lib/useApiResource";
import { useAsyncAction } from "@/lib/useAsyncAction";

type Props = {
  sheet: SheetItem;
  onRenamed: (sheet: SheetItem) => void;
  onArchived: () => void;
  /** The list of people changed (the number on the sheet may need to be refreshed). */
  onMembersChanged: () => void;
  onClose: () => void;
};

/** What each role can do, as a table the person can read before choosing. */
const MATRIX: { what: string; roles: Record<SheetRole | "admin", boolean> }[] = [
  { what: "See the sheet and its files", roles: { admin: true, manager: true, editor: true, commenter: true, viewer: true } },
  { what: "Comment and reply", roles: { admin: true, manager: true, editor: true, commenter: true, viewer: false } },
  { what: "Add and edit tasks, report them as done", roles: { admin: true, manager: true, editor: true, commenter: false, viewer: false } },
  { what: "Write the manager's feedback, approve or send back", roles: { admin: true, manager: true, editor: false, commenter: false, viewer: false } },
  { what: "Share the sheet and change roles", roles: { admin: true, manager: true, editor: false, commenter: false, viewer: false } },
  { what: "Rename, archive the sheet", roles: { admin: true, manager: false, editor: false, commenter: false, viewer: false } },
];

const COLUMNS: { id: SheetRole | "admin"; label: string }[] = [
  { id: "admin", label: "Admin" },
  { id: "manager", label: "Manage" },
  { id: "editor", label: "Edit" },
  { id: "commenter", label: "Comment" },
  { id: "viewer", label: "View" },
];

/**
 * "Share": who is on the sheet and what each person may do, from two levels: system admins see
 * every sheet; everybody else has the role given here. The sheet's admins also rename or archive it.
 */
export function ShareSheetDrawer({ sheet, onRenamed, onArchived, onMembersChanged, onClose }: Props) {
  const [adding, setAdding] = useState<string[]>([]);
  const [role, setRole] = useState<SheetRole>("viewer");
  const [name, setName] = useState(sheet.name);
  const { busy, message, run: execute } = useAsyncAction();

  const [loadKey, setLoadKey] = useState(0);
  const load = useCallback(async () => setLoadKey((n) => n + 1), []);

  const members = useApiResource(
    (signal) => listSheetMembers(sheet.id, signal),
    "Could not load the people on this sheet.",
    [sheet.id, loadKey],
  );

  const run = (action: () => Promise<void>, failure: string) =>
    execute(action, (error) => errorMessage(error, failure));

  const add = () =>
    run(async () => {
      for (const id of adding) await setSheetMember(sheet.id, id, role);
      setAdding([]);
      await load();
      onMembersChanged();
    }, "Could not add the people.");

  const change = (userId: string, next: SheetRole) =>
    run(async () => {
      await setSheetMember(sheet.id, userId, next);
      await load();
    }, "Could not change the role.");

  const remove = (userId: string) =>
    run(async () => {
      await removeSheetMember(sheet.id, userId);
      await load();
      onMembersChanged();
    }, "Could not remove the person.");

  const rename = (event: React.FormEvent) => {
    event.preventDefault();
    return run(async () => onRenamed(await renameSheet(sheet.id, name.trim())), "Could not rename.");
  };

  const archive = () =>
    run(async () => {
      await archiveSheet(sheet.id);
      onArchived();
    }, "Could not archive the sheet.");

  return (
    <Drawer open title={`Share “${sheet.name}”`} onClose={onClose} wide>
      <DrawerBody>
        <div className="flex flex-col gap-5">
          <section aria-label="Add people" className="grid gap-2">
            <h3 className="m-0 text-sm">Add people</h3>
            <UserPicker label="Add people" value={adding} onChange={setAdding} multiple />
            <div className="flex items-center gap-2">
              <Select
                aria-label="Role of the people added"
                className="h-8 w-auto py-0 text-[13px]"
                value={role}
                onChange={(event) => setRole(event.target.value as SheetRole)}
              >
                {SHEET_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {SHEET_ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                variant="primary"
                icon={UserPlus}
                disabled={busy || adding.length === 0}
                onClick={() => void add()}
              >
                Add
              </Button>
            </div>
          </section>

          <section aria-label="People on this sheet" className="grid gap-2">
            <h3 className="m-0 text-sm">People on this sheet</h3>
            <p className="m-0 flex items-center gap-2 rounded-md border border-line bg-surface-muted px-2.5 py-2 text-[13px]">
              <Badge>Admin</Badge>
              System admins always see every sheet, with full rights.
            </p>
            {members.kind === "loading" && <LoadingState>Loading…</LoadingState>}
            {members.kind === "error" && (
              <p className="m-0 text-sm text-muted">Could not load the people on this sheet.</p>
            )}
            {members.kind === "ready" && (
              <ul aria-label="Sheet members" className="m-0 grid list-none gap-1 p-0">
                {members.data.map((member) => (
                  <PersonRow key={member.user_id}>
                    <PersonIdentity name={member.full_name} code={member.employee_code} />
                    {member.is_owner && <Badge tone="info">Owner</Badge>}
                    <Select
                      aria-label={`Role of ${member.full_name}`}
                      className="h-8 w-auto py-0 text-[13px]"
                      value={member.role}
                      disabled={busy}
                      onChange={(event) => void change(member.user_id, event.target.value as SheetRole)}
                    >
                      {SHEET_ROLES.filter(
                        (r) => !member.is_owner || r === "editor" || r === "manager",
                      ).map((r) => (
                        <option key={r} value={r}>
                          {SHEET_ROLE_LABELS[r]}
                        </option>
                      ))}
                    </Select>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      disabled={busy || member.is_owner}
                      aria-label={`Remove ${member.full_name} from the sheet`}
                      title={member.is_owner ? "The owner cannot be removed" : "Remove"}
                      onClick={() => void remove(member.user_id)}
                    >
                      <X className="size-4" aria-hidden />
                    </Button>
                  </PersonRow>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="What each role can do" className="grid gap-2">
            <h3 className="m-0 text-sm">What each role can do</h3>
            <div className="overflow-x-auto rounded-md border border-line">
              <table className="m-0 w-full text-[12.5px]">
                <thead>
                  <tr>
                    <th scope="col">Action</th>
                    {COLUMNS.map((column) => (
                      <th key={column.id} scope="col" className="text-center">
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {MATRIX.map((row) => (
                    <tr key={row.what}>
                      <td>{row.what}</td>
                      {COLUMNS.map((column) => (
                        <td key={column.id} className="text-center">
                          {row.roles[column.id] ? (
                            <Check className="mx-auto size-4 text-success" aria-label="Yes" />
                          ) : (
                            <Minus className="mx-auto size-4 text-muted" aria-label="No" />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="m-0 text-xs text-muted">
              Seeing the Human resources data is a separate right. It does not come with a sheet.
            </p>
          </section>

          {sheet.is_admin && (
            <section aria-label="Sheet settings" className="grid gap-2 border-t border-line pt-4">
              <h3 className="m-0 text-sm">Sheet settings</h3>
              <form onSubmit={(event) => void rename(event)} className="flex items-center gap-2">
                <Input
                  aria-label="Sheet name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={200}
                />
                <Button
                  type="submit"
                  disabled={busy || name.trim() === "" || name.trim() === sheet.name}
                >
                  Rename
                </Button>
              </form>
              <div>
                <InlineConfirm
                  label="Archive sheet"
                  icon={Archive}
                  prompt="Archive? The tasks stay in the table."
                  confirmLabel="Yes, archive"
                  onConfirm={() => void archive()}
                />
              </div>
            </section>
          )}

          {message && <Alert>{message}</Alert>}
        </div>
      </DrawerBody>
    </Drawer>
  );
}
