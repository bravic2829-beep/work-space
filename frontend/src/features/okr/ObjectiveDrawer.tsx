"use client";

import { Save } from "lucide-react";
import { useState } from "react";

import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  DrawerBody,
  DrawerFooter,
  FormField,
  Input,
  InlineConfirm,
  Select,
  Textarea,
} from "@/components/ui";
import { UserPicker } from "@/features/tables/UserPicker";
import { firstProblem } from "@/lib/api/errors";
import { useAsyncAction } from "@/lib/useAsyncAction";

import { createObjective, deleteObjective, updateObjective } from "./api";
import {
  LEVEL_LABELS,
  LEVELS,
  type Cycle,
  type Objective,
  type OkrDepartment,
  type OkrLevel,
} from "./schema";

type Props = {
  cycle: Cycle;
  /** The objective being changed, or null to make a new one. */
  objective: Objective | null;
  /** The objectives of the cycle, to choose the one this supports. */
  objectives: Objective[];
  departments: OkrDepartment[];
  isAdmin: boolean;
  onSaved: (objective: Objective) => void;
  onDeleted: () => void;
  onClose: () => void;
};

const RANK: Record<OkrLevel, number> = { company: 0, department: 1, personal: 2 };
const FORM = "objective-form";

/**
 * Make or change an objective: what to achieve, for whom (the company, a department or one
 * person), and which higher objective it supports. The company's objectives are for admins, a
 * department's for its head, a personal one for oneself.
 */
export function ObjectiveDrawer({
  cycle,
  objective,
  objectives,
  departments,
  isAdmin,
  onSaved,
  onDeleted,
  onClose,
}: Props) {
  const editing = objective !== null;
  const [title, setTitle] = useState(objective?.title ?? "");
  const [description, setDescription] = useState(objective?.description ?? "");
  const [level, setLevel] = useState<OkrLevel>(objective?.level ?? "personal");
  const [departmentId, setDepartmentId] = useState(objective?.department?.id ?? "");
  const [owner, setOwner] = useState<string[]>(objective ? [objective.owner.id] : []);
  const [parentId, setParentId] = useState(objective?.parent_id ?? "");
  const [isPrivate, setIsPrivate] = useState(objective?.is_private ?? false);
  const { busy, message, run } = useAsyncAction();

  const mayMakeDepartment = isAdmin || departments.some((d) => d.can_create);
  const levels = LEVELS.filter(
    (l) => l === "personal" || (l === "company" && isAdmin) || (l === "department" && mayMakeDepartment),
  );
  // The level of an existing objective is changed by an admin only; the owner too.
  const levelLocked = editing && !isAdmin;
  const ownerLocked = !isAdmin;
  const departmentChoices = departments.filter((d) => isAdmin || d.can_create || d.id === departmentId);
  const parents = objectives.filter(
    (o) => o.id !== objective?.id && RANK[o.level] <= RANK[level],
  );
  const valid = title.trim() !== "" && (level !== "department" || departmentId !== "");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!valid) return;
    await run(
      async () => {
        const common = {
          title: title.trim(),
          description: description.trim() || null,
          level,
          department_id: level === "department" ? departmentId : null,
          parent_id: parentId || null,
          is_private: isPrivate,
        };
        const saved = objective
          ? await updateObjective(objective.id, {
              ...common,
              ...(isAdmin && owner[0] && owner[0] !== objective.owner.id ? { owner_id: owner[0] } : {}),
              ...(levelLocked ? { level: undefined } : {}),
            })
          : await createObjective({
              cycle_id: cycle.id,
              ...common,
              ...(isAdmin && owner[0] ? { owner_id: owner[0] } : {}),
            });
        onSaved(saved);
        onClose();
      },
      (error) => firstProblem(error, "Could not save the objective."),
    );
  }

  async function remove() {
    if (!objective) return;
    await run(
      async () => {
        await deleteObjective(objective.id);
        onDeleted();
        onClose();
      },
      (error) => firstProblem(error, "Could not delete the objective."),
    );
  }

  return (
    <Drawer open title={editing ? "Edit objective" : "New objective"} subtitle={cycle.name} onClose={onClose}>
      <DrawerBody>
        <form id={FORM} onSubmit={(event) => void save(event)} className="flex flex-col gap-4">
          <FormField label="Objective" hint="What do you want to achieve? Say it so a colleague understands it.">
            <Input
              value={title}
              maxLength={300}
              required
              onChange={(event) => setTitle(event.target.value)}
              placeholder="For example: Make the online shop our main sales channel"
            />
          </FormField>
          <FormField label="Why it matters (optional)">
            <Textarea
              rows={3}
              value={description}
              maxLength={5000}
              onChange={(event) => setDescription(event.target.value)}
            />
          </FormField>
          <FormField label="Level">
            <Select
              value={level}
              disabled={levelLocked}
              onChange={(event) => {
                setLevel(event.target.value as OkrLevel);
                setParentId("");
              }}
            >
              {levels.map((l) => (
                <option key={l} value={l}>
                  {LEVEL_LABELS[l]}
                </option>
              ))}
            </Select>
          </FormField>
          {level === "department" && (
            <FormField label="Department">
              <Select
                value={departmentId}
                disabled={levelLocked}
                onChange={(event) => setDepartmentId(event.target.value)}
              >
                <option value="">Choose a department…</option>
                {departmentChoices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </FormField>
          )}
          <FormField label="Supports (optional)" hint="The higher objective this one helps to reach.">
            <Select value={parentId} onChange={(event) => setParentId(event.target.value)}>
              <option value="">Nothing above it</option>
              {parents.map((o) => (
                <option key={o.id} value={o.id}>
                  {LEVEL_LABELS[o.level]} · {o.title}
                </option>
              ))}
            </Select>
          </FormField>
          {isAdmin && (
            <div className="grid gap-1">
              <span className="text-sm font-medium">Owner</span>
              <UserPicker label="Owner" value={owner} onChange={setOwner} multiple={false} />
              <p className="m-0 text-xs text-muted">Left empty, the owner is you.</p>
            </div>
          )}
          {!isAdmin && editing && ownerLocked && (
            <p className="m-0 text-xs text-muted">Owner: {objective?.owner.full_name}. Only an admin changes it.</p>
          )}
          <Checkbox
            label="Private: only its owner, the people on its key results, their managers and admins see it"
            checked={isPrivate}
            onChange={(event) => setIsPrivate(event.target.checked)}
          />
          {message && <Alert>{message}</Alert>}
        </form>
      </DrawerBody>
      <DrawerFooter>
        <Button type="submit" form={FORM} variant="primary" icon={Save} loading={busy} disabled={!valid}>
          {editing ? "Save changes" : "Create objective"}
        </Button>
        <Button onClick={onClose}>Cancel</Button>
        {objective?.can_edit && (
          <span className="ml-auto">
            <InlineConfirm
              label="Delete"
              prompt="Delete it and its key results?"
              confirmLabel="Yes, delete"
              disabled={busy}
              onConfirm={() => void remove()}
            />
          </span>
        )}
      </DrawerFooter>
    </Drawer>
  );
}
