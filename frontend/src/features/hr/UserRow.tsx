"use client";

import { Pencil } from "lucide-react";

import { Avatar, Badge, Button } from "@/components/ui";
import { LEVEL_LABELS, type User } from "@/features/auth/schema";

import { InlineConfirm } from "./InlineConfirm";

type Props = {
  user: User;
  departmentName: string;
  isSelf: boolean;
  /** This row is the one open in the drawer. */
  selected: boolean;
  busy: boolean;
  onEdit: () => void;
  onSetStatus: (status: "active" | "disabled") => void;
};

/** One employee in the grid. Clicking the row opens it in the drawer; the buttons stay on the right. */
export function UserRow({ user, departmentName, isSelf, selected, busy, onEdit, onSetStatus }: Props) {
  // The owner is protected by the backend, so there is nothing to do on that row.
  const isOwner = user.org_role === "owner";
  const active = user.status === "active";

  return (
    <tr
      onClick={isOwner ? undefined : onEdit}
      className={
        selected
          ? "bg-primary-soft"
          : isOwner
            ? undefined
            : "cursor-pointer"
      }
    >
      <td className="font-mono text-xs">{user.employee_code}</td>
      <td>
        <span className="inline-flex items-center gap-2">
          <Avatar name={user.full_name} className="size-5 text-[10px]" />
          <span className={active ? "font-medium" : "font-medium text-muted"}>{user.full_name}</span>
          {isSelf && <Badge tone="info">You</Badge>}
        </span>
      </td>
      <td>{LEVEL_LABELS[user.level]}</td>
      <td className={departmentName ? undefined : "text-muted"}>{departmentName || "—"}</td>
      <td>
        <Badge tone={active ? "success" : "neutral"}>
          <span
            aria-hidden
            className={`mr-1.5 size-1.5 rounded-full ${active ? "bg-success" : "bg-muted"}`}
          />
          {active ? "Active" : "Disabled"}
        </Badge>
      </td>
      <td className="text-right whitespace-nowrap" onClick={(event) => event.stopPropagation()}>
        {!isOwner && (
          <span className="inline-flex items-center justify-end gap-1">
            <Button size="sm" variant="ghost" icon={Pencil} disabled={busy} onClick={onEdit}>
              Edit
            </Button>
            {/* A fixed-width slot, so Edit is in the same place on every row. */}
            <span className="inline-flex min-w-16 justify-start">
              {!isSelf &&
                (active ? (
                  <InlineConfirm
                    label="Disable"
                    prompt="Disable and sign out?"
                    confirmLabel="Yes, disable"
                    disabled={busy}
                    onConfirm={() => onSetStatus("disabled")}
                  />
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => onSetStatus("active")}
                  >
                    Enable
                  </Button>
                ))}
            </span>
          </span>
        )}
      </td>
    </tr>
  );
}
