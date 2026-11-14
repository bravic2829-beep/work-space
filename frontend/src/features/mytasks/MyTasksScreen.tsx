"use client";

import { CalendarDays, Inbox, ListChecks } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Alert, Button, DataTable, EmptyState, LoadingState, PageHeader } from "@/components/ui";
import { StatusBadge } from "@/features/tables/StatusBadge";
import { ApiError } from "@/lib/api/client";

import { listMyTasks, type Scope } from "./api";
import type { MyTask } from "./schema";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; items: MyTask[]; nextCursor: string | null };

const TABS = [
  { scope: "assigned", label: "Assigned to me", icon: ListChecks },
  { scope: "today", label: "Today's tasks", icon: CalendarDays },
] as const;

/** The workspace that gathers my tasks from every table (UC-K9). */
export function MyTasksScreen() {
  const [scope, setScope] = useState<Scope>("assigned");
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const page = await listMyTasks(scope, null, controller.signal);
        setState({ kind: "ready", items: page.items, nextCursor: page.next_cursor });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          kind: "error",
          message: error instanceof ApiError ? error.message : "Could not load your tasks.",
        });
      }
    }

    void load();
    return () => controller.abort();
  }, [scope]);

  function choose(next: Scope) {
    if (next === scope) return;
    setState({ kind: "loading" });
    setScope(next);
  }

  async function loadMore() {
    if (state.kind !== "ready" || state.nextCursor === null) return;
    try {
      const page = await listMyTasks(scope, state.nextCursor);
      setState({
        kind: "ready",
        items: [...state.items, ...page.items],
        nextCursor: page.next_cursor,
      });
    } catch (error) {
      setState({
        kind: "error",
        message: error instanceof ApiError ? error.message : "Could not load more tasks.",
      });
    }
  }

  return (
    <>
      <PageHeader title="My tasks" description="Tasks given to you, from every table." />
      <div className="grid gap-4">
        <div role="group" aria-label="Which tasks" className="flex gap-2">
          {TABS.map((tab) => (
            <Button
              key={tab.scope}
              variant={scope === tab.scope ? "primary" : "secondary"}
              icon={tab.icon}
              aria-pressed={scope === tab.scope}
              onClick={() => choose(tab.scope)}
            >
              {tab.label}
            </Button>
          ))}
        </div>
        {state.kind === "loading" && <LoadingState />}
        {state.kind === "error" && <Alert>{state.message}</Alert>}
        {state.kind === "ready" && state.items.length === 0 && (
          <EmptyState
            icon={Inbox}
            title={scope === "today" ? "Nothing is due today." : "No tasks are assigned to you."}
          />
        )}
        {state.kind === "ready" && state.items.length > 0 && (
          <DataTable dense>
            <thead>
              <tr>
                <th>Task</th>
                <th>Table</th>
                <th>Status</th>
                <th>Due</th>
              </tr>
            </thead>
            <tbody>
              {state.items.map((task) => (
                <tr key={task.id}>
                  <td className="font-medium">
                    <Link href={`/tables/${task.table_id}`}>{task.name ?? "(name hidden)"}</Link>
                  </td>
                  <td>{task.table_name}</td>
                  <td>
                    {task.status && <StatusBadge name={task.status.name} kind={task.status.kind} />}
                  </td>
                  <td>{task.due_date ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
        {state.kind === "ready" && state.nextCursor !== null && (
          <div>
            <Button onClick={() => void loadMore()}>Load more</Button>
          </div>
        )}
      </div>
    </>
  );
}
