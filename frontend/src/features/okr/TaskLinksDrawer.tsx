"use client";

import { useState } from "react";

import { Alert, Button, Drawer, DrawerBody, Input, LoadingState, Select } from "@/components/ui";
import { listReportTables } from "@/features/reports/api";
import { getTable, listRecords } from "@/features/tables/api";
import { titleField } from "@/features/tables/taskWorkflow";
import { errorMessage } from "@/lib/api/errors";
import { useApiResource, type Resource } from "@/lib/useApiResource";
import { useAsyncAction } from "@/lib/useAsyncAction";

import { changeTaskLink } from "./api";
import type { KeyResult } from "./schema";

export function TaskLinksDrawer({ kr, onChanged, onClose }: {
  kr: KeyResult;
  onChanged: () => void;
  onClose: () => void;
}) {
  const tables = useApiResource(listReportTables, "Could not load task tables.", []);
  const [tableId, setTableId] = useState("");
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const action = useAsyncAction();
  const tasks = kr.tasks ?? [];
  const results = useApiResource(async (signal) => {
    const matches = { tableId, query, items: [] as { id: string; title: string }[] };
    if (!tableId || !query) return matches;
    const table = await getTable(tableId, signal);
    const title = titleField(table.fields);
    if (!title) return matches;
    const page = await listRecords(tableId, {
      filter: [{ field: title.id, op: "contains", value: query }],
      sort: [],
      limit: 20,
    }, signal);
    matches.items = page.items.map((record) => ({
      id: record.id,
      title: String(record.data[title.id] ?? "Untitled task"),
    }));
    return matches;
  }, "Could not find tasks.", [tableId, query]);

  function change(id: string, attach: boolean) {
    void action.run(async () => {
      await changeTaskLink(kr.id, id, attach);
      onChanged();
      onClose();
    }, (error) => errorMessage(error, "Could not update the task link."));
  }

  return (
    <Drawer open title="Linked tasks" subtitle={kr.title} onClose={onClose}>
      <DrawerBody className="grid content-start gap-4">
        {tasks.length > 0 ? (
          <ul className="m-0 grid list-none gap-2 p-0">
            {tasks.map((task) => (
              <li key={task.id} className="flex items-center justify-between gap-2">
                <span>{task.title ?? "Task name hidden"}</span>
                <Button size="sm" disabled={action.busy} onClick={() => change(task.id, false)}>
                  Unlink
                </Button>
              </li>
            ))}
          </ul>
        ) : <p className="m-0 text-sm text-muted">No linked tasks you can view.</p>}
        {tables.kind === "loading" && <LoadingState />}
        {tables.kind === "error" && <Alert>{tables.message}</Alert>}
        {tables.kind === "ready" && (
          <form className="grid gap-2" onSubmit={(event) => {
            event.preventDefault();
            setQuery(text.trim());
          }}>
            <Select aria-label="Task table" value={tableId} onChange={(event) => {
              setTableId(event.target.value);
              setQuery("");
            }}>
              <option value="">Choose a task table</option>
              {tables.data.map((table) => (
                <option key={table.id} value={table.id}>{table.workspace_name} / {table.name}</option>
              ))}
            </Select>
            <div className="flex gap-2">
              <Input aria-label="Task name" value={text} onChange={(event) => setText(event.target.value)} />
              <Button type="submit" disabled={!tableId || !text.trim()}>Search</Button>
            </div>
          </form>
        )}
        {query && <TaskMatches results={results} tableId={tableId} query={query} linked={tasks}
          busy={action.busy} onLink={(id) => change(id, true)} />}
        {action.message && <Alert>{action.message}</Alert>}
      </DrawerBody>
    </Drawer>
  );
}

function TaskMatches({ results, tableId, query, linked, busy, onLink }: {
  results: Resource<{ tableId: string; query: string; items: { id: string; title: string }[] }>;
  tableId: string;
  query: string;
  linked: NonNullable<KeyResult["tasks"]>;
  busy: boolean;
  onLink: (id: string) => void;
}) {
  if (results.kind === "loading") return <LoadingState />;
  if (results.kind === "error") return <Alert>{results.message}</Alert>;
  if (results.data.tableId !== tableId || results.data.query !== query) return <LoadingState />;
  const matches = results.data.items.filter((task) => !linked.some((item) => item.id === task.id));
  return matches.length === 0 ? <p className="m-0 text-sm text-muted">No matching tasks to link.</p> : (
    <ul className="m-0 grid list-none gap-1 p-0">
      {matches.map((task) => (
        <li key={task.id}><Button size="sm" disabled={busy} onClick={() => onLink(task.id)}>
          Link {task.title}
        </Button></li>
      ))}
    </ul>
  );
}
