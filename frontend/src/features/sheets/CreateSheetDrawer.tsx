"use client";

import { Users } from "lucide-react";
import { useState } from "react";

import {
  Alert,
  Button,
  Drawer,
  DrawerBody,
  DrawerFooter,
  FormField,
  Input,
  Select,
} from "@/components/ui";
import { UserPicker } from "@/features/tables/UserPicker";
import { firstProblem } from "@/lib/api/errors";
import { useAsyncAction } from "@/lib/useAsyncAction";

import { createSheet } from "./api";
import { SHEET_ROLE_LABELS, SHEET_ROLES, type SheetItem, type SheetRole } from "./schema";

type Props = {
  tableId: string;
  onCreated: (sheet: SheetItem) => void;
  onClose: () => void;
};

/**
 * "Create sheet": give one person their own sheet of the task table. The person always edits it.
 * Other people can be added now, or later from Share. Making a sheet does not give anybody access
 * to employee data.
 */
export function CreateSheetDrawer({ tableId, onCreated, onClose }: Props) {
  const [owner, setOwner] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [others, setOthers] = useState<string[]>([]);
  const [role, setRole] = useState<SheetRole>("viewer");
  const { busy, message, run } = useAsyncAction();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (owner.length !== 1) return;
    await run(
      async () => {
        const created = await createSheet(tableId, {
          owner_id: owner[0],
          ...(name.trim() ? { name: name.trim() } : {}),
          members: others.filter((id) => id !== owner[0]).map((user_id) => ({ user_id, role })),
        });
        onCreated(created);
        onClose();
      },
      (error) => firstProblem(error, "Could not create the sheet."),
    );
  }

  return (
    <Drawer open title="Create sheet" onClose={onClose}>
      <DrawerBody>
        <form id="create-sheet-form" onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <div className="grid gap-1">
            <span className="text-sm font-medium">Employee</span>
            <UserPicker label="Employee" value={owner} onChange={setOwner} multiple={false} />
            <p className="m-0 text-xs text-muted">
              The tasks assigned to this person appear on their sheet and always stay in the
              table. They can edit their own sheet.
            </p>
          </div>
          <FormField label="Sheet name">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={200}
              placeholder="Defaults to the employee's name"
            />
          </FormField>
          <div className="grid gap-1">
            <span className="text-sm font-medium">Also share with</span>
            <UserPicker label="Also share with" value={others} onChange={setOthers} multiple />
            <label className="mt-1 flex items-center gap-2 text-[13px]">
              They can
              <Select
                aria-label="Role of the people added"
                className="h-8 w-auto py-0 text-[13px]"
                value={role}
                onChange={(event) => setRole(event.target.value as SheetRole)}
              >
                {SHEET_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {SHEET_ROLE_LABELS[r].replace("Can ", "")}
                  </option>
                ))}
              </Select>
              the sheet
            </label>
          </div>
          <p className="m-0 rounded-md bg-primary-soft px-3 py-2 text-xs text-primary">
            Having a sheet does not give access to the Human resources data.
          </p>
          {message && <Alert>{message}</Alert>}
        </form>
      </DrawerBody>
      <DrawerFooter>
        <Button
          type="submit"
          form="create-sheet-form"
          variant="primary"
          icon={Users}
          loading={busy}
          disabled={owner.length !== 1}
        >
          Create sheet
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </DrawerFooter>
    </Drawer>
  );
}
