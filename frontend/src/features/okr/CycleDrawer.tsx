"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

import {
  Alert,
  Badge,
  Button,
  Drawer,
  DrawerBody,
  FormField,
  InlineConfirm,
  Input,
} from "@/components/ui";
import { firstProblem } from "@/lib/api/errors";
import { useAsyncAction } from "@/lib/useAsyncAction";

import { createCycle, deleteCycle, updateCycle } from "./api";
import type { Cycle } from "./schema";

type Props = {
  cycles: Cycle[];
  /** A cycle was added, closed, opened or deleted: read the list again. */
  onChanged: (created?: Cycle) => void;
  onClose: () => void;
};

/** For admins: open a cycle (a quarter, a year), close it when it ends, open it again, delete an empty one. */
export function CycleDrawer({ cycles, onChanged, onClose }: Props) {
  const [name, setName] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const { busy, message, run } = useAsyncAction();
  const valid = name.trim() !== "" && startsOn !== "" && endsOn !== "" && endsOn >= startsOn;

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!valid) return;
    await run(
      async () => {
        const created = await createCycle({ name: name.trim(), starts_on: startsOn, ends_on: endsOn });
        setName("");
        setStartsOn("");
        setEndsOn("");
        onChanged(created);
      },
      (error) => firstProblem(error, "Could not open the cycle."),
    );
  }

  const act = (action: () => Promise<unknown>, failure: string) =>
    run(async () => {
      await action();
      onChanged();
    }, (error) => firstProblem(error, failure));

  return (
    <Drawer open title="OKR cycles" subtitle="A quarter or a year of objectives" onClose={onClose}>
      <DrawerBody>
        <ul aria-label="Cycles" className="m-0 grid list-none gap-2 p-0">
          {cycles.length === 0 && <li className="text-sm text-muted">No cycle yet. Open the first one below.</li>}
          {cycles.map((cycle) => (
            <li key={cycle.id} className="flex flex-wrap items-center gap-2 rounded-md border border-line px-3 py-2">
              <span className="font-medium">{cycle.name}</span>
              <Badge tone={cycle.status === "open" ? "success" : "neutral"}>
                {cycle.status === "open" ? "Open" : "Closed"}
              </Badge>
              <span className="text-xs text-muted">
                {cycle.starts_on} to {cycle.ends_on}
              </span>
              <span className="ml-auto flex items-center gap-1">
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () => updateCycle(cycle.id, { status: cycle.status === "open" ? "closed" : "open" }),
                      "Could not change the cycle.",
                    )
                  }
                >
                  {cycle.status === "open" ? "Close" : "Open again"}
                </Button>
                <InlineConfirm
                  label="Delete"
                  prompt="Delete this cycle?"
                  confirmLabel="Yes, delete"
                  disabled={busy}
                  onConfirm={() => void act(() => deleteCycle(cycle.id), "Could not delete the cycle.")}
                />
              </span>
            </li>
          ))}
        </ul>

        <form onSubmit={(event) => void add(event)} className="grid gap-3 rounded-lg border border-line p-3">
          <h3 className="m-0 text-sm">Open a cycle</h3>
          <FormField label="Name">
            <Input
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              placeholder="2027 Q1"
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Starts on">
              <Input type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} />
            </FormField>
            <FormField label="Ends on">
              <Input type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} />
            </FormField>
          </div>
          {message && <Alert>{message}</Alert>}
          <div>
            <Button type="submit" variant="primary" icon={Plus} loading={busy} disabled={!valid}>
              Open cycle
            </Button>
          </div>
        </form>
      </DrawerBody>
    </Drawer>
  );
}
