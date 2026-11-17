"use client";

import {
  AlertTriangle,
  CalendarDays,
  ClipboardCheck,
  Eye,
  Inbox,
  ListChecks,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Alert, Button, EmptyState, LoadingState, PageHeader, Tabs } from "@/components/ui";
import { useLiveRefresh } from "@/features/notifications/liveRefresh";

import { listMyTasks, type Scope } from "./api";
import { localToday, type MyTask } from "./schema";
import { GroupedTaskList, isOverdue, TaskList } from "./TaskList";
import { errorMessage } from "@/lib/api/errors";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; items: MyTask[]; nextCursor: string | null };

type Tab = "assigned" | "today" | "overdue" | "review" | "following";

const TABS = [
  { id: "assigned", label: "Assigned to me", icon: ListChecks },
  { id: "today", label: "Due today", icon: CalendarDays },
  { id: "overdue", label: "Overdue", icon: AlertTriangle },
  { id: "review", label: "Waiting for my review", icon: ClipboardCheck },
  { id: "following", label: "Following", icon: Eye },
] as const;

/** Overdue is a view of the assigned tasks, so it loads the same list as "Assigned to me". */
function scopeOf(tab: Tab): Scope {
  return tab === "overdue" ? "assigned" : tab;
}

const EMPTY: Record<Tab, string> = {
  assigned: "No tasks are assigned to you.",
  today: "Nothing is due today.",
  overdue: "Nothing is overdue.",
  review: "Nothing is waiting for your review.",
  following: "You do not follow any task.",
};

/** The workspace that gathers my tasks from every table (UC-K9). */
export function MyTasksScreen() {
  const [tab, setTab] = useState<Tab>("assigned");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [refreshKey, setRefreshKey] = useState(0);
  const scope = scopeOf(tab);
  const today = localToday();

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
          message: errorMessage(error, "Could not load your tasks."),
        });
      }
    }

    void load();
    return () => controller.abort();
  }, [scope, refreshKey]);

  // A task given to me appears at once: the list is read again when the socket says so.
  useLiveRefresh(() => setRefreshKey((n) => n + 1));

  function choose(next: Tab) {
    if (next === tab) return;
    // "Assigned to me" and "Overdue" show the same loaded list, so only a new scope reloads.
    if (scopeOf(next) !== scope) setState({ kind: "loading" });
    setTab(next);
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
        message: errorMessage(error, "Could not load more tasks."),
      });
    }
  }

  const items = useMemo(() => {
    if (state.kind !== "ready") return [];
    return tab === "overdue" ? state.items.filter((task) => isOverdue(task, today)) : state.items;
  }, [state, tab, today]);

  const emptyTitle = EMPTY[tab];

  return (
    <>
      <PageHeader
        title="My tasks"
        description="Tasks given to you, waiting for your review, or that you follow, from every table."
      />
      <div className="grid gap-4">
        <Tabs
          label="Which tasks"
          idPrefix="mytasks"
          tabs={TABS.map(({ id, label, icon }) => ({ id, label, icon }))}
          value={tab}
          onChange={choose}
        />
        <div
          role="tabpanel"
          id={`mytasks-panel-${tab}`}
          aria-labelledby={`mytasks-tab-${tab}`}
          className="grid gap-4"
        >
          {state.kind === "loading" && <LoadingState />}
          {state.kind === "error" && <Alert>{state.message}</Alert>}
          {state.kind === "ready" && items.length === 0 && (
            <EmptyState icon={Inbox} title={emptyTitle} />
          )}
          {state.kind === "ready" && items.length > 0 && (
            // The Today and Overdue tabs already are one group each.
            tab === "today" || tab === "overdue" ? (
              <TaskList items={items} today={today} />
            ) : (
              <GroupedTaskList items={items} today={today} />
            )
          )}
          {state.kind === "ready" && state.nextCursor !== null && (
            <div>
              <Button onClick={() => void loadMore()}>Load more</Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
