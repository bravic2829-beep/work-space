"use client";

import {
  Lock,
  MoreHorizontal,
  Plus,
  Settings2,
  Share2,
  Timer,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { useState } from "react";

import { Button, Input, Menu, SplitButton, type MenuItem } from "@/components/ui";
import { cn } from "@/lib/cn";

import type { ViewItem } from "./schema";

type ViewProps = {
  views: ViewItem[];
  /** The id of the saved view in use, or "" for all records. */
  activeView: string;
  onApplyView: (id: string) => void;
  /** Saves the current filter, sort and columns under this name. True when it was saved. */
  onSaveView: (name: string) => Promise<boolean>;
  onRemoveView: () => void;
};

type ActionProps = {
  /** May add records (an editor of the table, or of the sheet being shown). */
  canEdit: boolean;
  /** May change the columns: an editor of the whole table, never somebody on a sheet. */
  canEditColumns: boolean;
  canAssign: boolean;
  /** Name of the plain "add one" button; a sheet calls it "Add task". */
  addLabel?: string;
  /** Present when the person may share the open sheet: puts "Share" in the ⋯ menu. */
  onShare?: () => void;
  canMakeSheet: boolean;
  canAddTimer: boolean;
  /** An admin of the workspace (or of the organization): may choose who sees which column. */
  canSetAccess?: boolean;
  addingTimer: boolean;
  onNewRecord: () => void;
  onAssign: () => void;
  onAddField: () => void;
  onManageFields: () => void;
  onAddTimer: () => void;
  onCreateSheet: () => void;
  onColumnAccess?: () => void;
};

function Chip({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-[26px] rounded-full border border-transparent bg-transparent px-3 text-[13px] hover:bg-surface-muted",
        active ? "bg-primary-soft font-semibold text-primary hover:bg-primary-soft" : "font-normal text-muted",
      )}
    >
      {children}
    </button>
  );
}

/** The views as chips, and "Save view" to keep what is on screen as a new one. */
export function ViewChips({ views, activeView, onApplyView, onSaveView, onRemoveView }: ViewProps) {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (await onSaveView(name.trim())) {
      setSaving(false);
      setName("");
    }
  }

  return (
    <section aria-label="Views" className="flex flex-wrap items-center gap-1">
      <Chip active={activeView === ""} onClick={() => onApplyView("")}>
        All records
      </Chip>
      {views.map((view) => (
        <Chip key={view.id} active={view.id === activeView} onClick={() => onApplyView(view.id)}>
          {view.name}
        </Chip>
      ))}
      {activeView && (
        <Button
          size="icon"
          variant="ghost"
          className="size-6"
          aria-label="Delete this view"
          title="Delete this view"
          onClick={onRemoveView}
        >
          <Trash2 className="size-3.5" aria-hidden />
        </Button>
      )}
      {saving ? (
        <form onSubmit={(event) => void save(event)} className="flex items-center gap-1.5">
          <Input
            aria-label="View name"
            className="h-7 w-40 py-0 text-[13px]"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
            required
          />
          <Button type="submit" size="sm" variant="primary" disabled={name.trim() === ""}>
            Save view
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSaving(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setSaving(true)}
          className="h-[26px] border-0 bg-transparent px-2 text-[13px] font-normal text-primary hover:bg-transparent hover:underline"
        >
          <Plus className="size-3.5" aria-hidden />
          Save view
        </button>
      )}
    </section>
  );
}

/**
 * The table's main action (assign a task, or add a record) with its setup tools behind the "⋯"
 * menu. Each shows only to the people who may use it.
 */
export function TableActions(props: ActionProps) {
  const { canEdit, canEditColumns, canAssign, canMakeSheet, canAddTimer, addingTimer } = props;

  const setup: MenuItem[] = [
    ...(props.onShare ? [{ label: "Share", icon: Share2, onSelect: props.onShare }] : []),
    ...(canEditColumns
      ? [
          { label: "Add a column", icon: Plus, onSelect: props.onAddField },
          { label: "Manage columns", icon: Settings2, onSelect: props.onManageFields },
        ]
      : []),
    ...(canAddTimer
      ? [{ label: addingTimer ? "Adding timer…" : "Add timer", icon: Timer, onSelect: props.onAddTimer }]
      : []),
    ...(canMakeSheet ? [{ label: "Create sheet", icon: Users, onSelect: props.onCreateSheet }] : []),
    ...(props.canSetAccess && props.onColumnAccess
      ? [{ label: "Column access", icon: Lock, onSelect: props.onColumnAccess }]
      : []),
  ];

  return (
    <>
      {setup.length > 0 && (
        <Menu
          trigger={
            <Button size="icon" variant="ghost" aria-label="Table menu" className="size-7">
              <MoreHorizontal className="size-4" aria-hidden />
            </Button>
          }
          items={setup}
        />
      )}
      {canEdit &&
        (canAssign ? (
          <SplitButton
            label="Assign task"
            icon={UserPlus}
            onClick={props.onAssign}
            moreLabel="More ways to add"
            items={[{ label: "New record", icon: Plus, onSelect: props.onNewRecord }]}
          />
        ) : (
          <Button variant="primary" size="sm" icon={Plus} onClick={props.onNewRecord}>
            {props.addLabel ?? "New record"}
          </Button>
        ))}
    </>
  );
}
