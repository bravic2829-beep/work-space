"use client";

import { MoreHorizontal, Pencil, KeyRound, UserX } from "lucide-react";
import { useState } from "react";

import {
  Badge,
  Button,
  InlineConfirm,
  Menu,
  PersonIdentity,
  type MenuItem,
} from "@/components/ui";
import { LEVEL_LABELS, type User } from "@/features/auth/schema";

import { departmentParts } from "./departmentTree";
import { PersonLabel } from "./PersonLabel";
import type { Department } from "./schema";

type Props = {
  user: User;
  /** The department of the employee, if they have one, and all of them (for the division). */
  department: Department | undefined;
  departments: Department[];
  isSelf: boolean;
  /** This row is the one open in the drawer. */
  selected: boolean;
  busy: boolean;
  onEdit: () => void;
  onResetPassword: () => void;
  onSetStatus: (status: "active" | "disabled") => void;
};

/** One employee in the grid. Clicking the row opens it in the drawer; the "⋯" menu has the rest. */
export function UserRow({
  user,
  department,
  departments,
  isSelf,
  selected,
  busy,
  onEdit,
  onResetPassword,
  onSetStatus,
}: Props) {
  const [asking, setAsking] = useState(false);
  // The owner is protected by the backend, so there is nothing to do on that row.
  const isOwner = user.org_role === "owner";
  const active = user.status === "active";
  const place = department ? departmentParts(department, departments) : null;

  const actions: MenuItem[] = [
    { label: "Edit", icon: Pencil, onSelect: onEdit },
    ...(isSelf ? [] : [{ label: "Reset password…", icon: KeyRound, onSelect: onResetPassword }]),
    ...(isSelf
      ? []
      : [
          active
            ? { label: "Disable…", icon: UserX, onSelect: () => setAsking(true) }
            : { label: "Enable", icon: UserX, onSelect: () => onSetStatus("active") },
        ]),
  ];

  return (
    <tr
      onClick={isOwner ? undefined : onEdit}
      className={selected ? "bg-primary-soft" : isOwner ? undefined : "cursor-pointer"}
    >
      <td>
        <span className={active ? "inline-flex items-center gap-2" : "inline-flex items-center gap-2 text-muted"}>
          <PersonIdentity name={user.full_name} code={user.employee_code} />
          {isSelf && <Badge tone="info">You</Badge>}
          {user.must_change_password && <Badge tone="warning">Temporary password</Badge>}
        </span>
      </td>
      <td>{LEVEL_LABELS[user.level]}</td>
      <td className={place ? undefined : "text-line-strong"}>
        {place ? (
          <>
            {place.name}
            {place.parentName && <span className="text-muted"> · {place.parentName}</span>}
          </>
        ) : (
          "—"
        )}
      </td>
      <td>
        <PersonLabel userId={user.manager_id} />
      </td>
      <td>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className={`size-1.5 rounded-full ${active ? "bg-success" : "bg-line-strong"}`}
          />
          <span className={active ? undefined : "text-muted"}>{active ? "Active" : "Disabled"}</span>
        </span>
      </td>
      <td className="text-right whitespace-nowrap" onClick={(event) => event.stopPropagation()}>
        {!isOwner && (
          <span className="inline-flex items-center justify-end gap-1.5">
            <InlineConfirm
              open={asking}
              onOpenChange={setAsking}
              hideTrigger
              label="Disable"
              prompt="Disable and sign out?"
              confirmLabel="Yes, disable"
              disabled={busy}
              onConfirm={() => onSetStatus("disabled")}
            />
            {!asking && (
              <Menu
                trigger={
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    disabled={busy}
                    aria-label={`Actions for ${user.full_name}`}
                  >
                    <MoreHorizontal className="size-4" aria-hidden />
                  </Button>
                }
                items={actions}
              />
            )}
          </span>
        )}
      </td>
    </tr>
  );
}
