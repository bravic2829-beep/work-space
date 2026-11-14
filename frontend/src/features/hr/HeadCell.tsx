"use client";

import { Pencil, UserPlus, X } from "lucide-react";
import { useState } from "react";

import { Avatar, Button } from "@/components/ui";
import { UserPicker } from "@/features/tables/UserPicker";
import { useUserNames } from "@/features/tables/useUserNames";

type Props = {
  /** The department's name, used in the labels of the buttons. */
  department: string;
  headId: string | null;
  onChange: (headId: string | null) => void;
  disabled?: boolean;
};

/**
 * The head of a department in one table cell. With a head it is a name with "change" and "remove";
 * without one it is a single "Assign head" button. The search box only opens when it is needed,
 * so the table does not carry an empty search field on every row.
 */
export function HeadCell({ department, headId, onChange, disabled }: Props) {
  const [picking, setPicking] = useState(false);
  const names = useUserNames(headId ? [headId] : []);

  if (picking) {
    return (
      <div className="inline-flex items-start gap-1 py-1">
        <div className="w-72">
          <UserPicker
            label={`Head of ${department}`}
            value={headId ? [headId] : []}
            onChange={(ids) => {
              setPicking(false);
              onChange(ids[0] ?? null);
            }}
            multiple={false}
            disabled={disabled}
          />
        </div>
        <Button size="sm" variant="ghost" onClick={() => setPicking(false)}>
          Cancel
        </Button>
      </div>
    );
  }

  if (!headId) {
    return (
      <Button
        size="sm"
        variant="ghost"
        icon={UserPlus}
        disabled={disabled}
        aria-label={`Assign head of ${department}`}
        className="text-muted"
        onClick={() => setPicking(true)}
      >
        Assign head
      </Button>
    );
  }

  // The cache holds "Name (CODE)". The initials come from the name only, and the code is shown
  // quietly beside it.
  const label = names.get(headId) ?? "…";
  const parts = /^(.*) \(([^)]+)\)$/.exec(label);
  const name = parts?.[1] ?? label;
  const code = parts?.[2];
  return (
    <span className="inline-flex items-center gap-1.5">
      <Avatar name={name} className="size-5 text-[10px]" />
      <span className="truncate">{name}</span>
      {code && <span className="font-mono text-xs text-muted">{code}</span>}
      <Button
        size="icon"
        variant="ghost"
        className="size-6"
        disabled={disabled}
        aria-label={`Change head of ${department}`}
        onClick={() => setPicking(true)}
      >
        <Pencil className="size-3.5" aria-hidden />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-6"
        disabled={disabled}
        aria-label={`Remove head of ${department}`}
        onClick={() => onChange(null)}
      >
        <X className="size-3.5" aria-hidden />
      </Button>
    </span>
  );
}
