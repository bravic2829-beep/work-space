"use client";

import { useRef, useState } from "react";

import { Alert, Button, Drawer, DrawerBody, DrawerFooter, ErrorMessage, FormField, Input, SegmentedControl, Select } from "@/components/ui";

import { createDepartment } from "./api";
import type { Department, DepartmentKind } from "./schema";

type Props = {
  open: boolean;
  departments: Department[];
  onClose: () => void;
  /** Called after each department is created, so the list behind the drawer can refresh. */
  onCreated: () => void;
};

const KIND_OPTIONS: { value: DepartmentKind; label: string }[] = [
  { value: "department", label: "Department" },
  { value: "division", label: "Division" },
];

/**
 * "New department" in a side panel. After saving it stays open and empties the name, so several
 * departments can be entered in a row; the type and the division are kept for the next one.
 */
export function DepartmentDrawer({ open, departments, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<DepartmentKind>("department");
  const [parentId, setParentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<string | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  const divisions = departments.filter((item) => item.kind === "division");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      await createDepartment({
        name: trimmed,
        kind,
        // Only a department can sit under a division.
        parent_id: kind === "department" && parentId ? parentId : null,
      });
      setCreated(trimmed);
      setName("");
      onCreated();
      nameInput.current?.focus();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open={open} title="New department" onClose={onClose}>
      <form onSubmit={submit} aria-label="Add department" className="flex min-h-0 flex-1 flex-col">
        <DrawerBody>
          <FormField label="Name">
            <Input
              ref={nameInput}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={200}
              required
            />
          </FormField>

          <div className="grid gap-1.5">
            <span aria-hidden className="text-sm font-medium">
              Type
            </span>
            <SegmentedControl
              label="Type"
              options={KIND_OPTIONS}
              value={kind}
              onChange={setKind}
            />
            <p className="m-0 text-xs text-muted">
              {kind === "division"
                ? "A division groups several departments. It sits at the top level."
                : "A department is a team. It can sit under a division, or stand alone."}
            </p>
          </div>

          {kind === "department" && (
            <FormField label="Under division" hint="Leave empty for a top-level department.">
              <Select value={parentId} onChange={(event) => setParentId(event.target.value)}>
                <option value="">None (top level)</option>
                {divisions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </FormField>
          )}

          <ErrorMessage error={error} />
          {created && <Alert tone="success">Created “{created}”. Add another, or close.</Alert>}
        </DrawerBody>
        <DrawerFooter>
          <Button type="submit" variant="primary" loading={busy}>
            Add department
          </Button>
          <Button onClick={onClose}>Close</Button>
        </DrawerFooter>
      </form>
    </Drawer>
  );
}
