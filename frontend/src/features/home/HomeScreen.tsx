"use client";

import {
  AlertTriangle,
  CalendarDays,
  FolderKanban,
  Inbox,
  ListChecks,
  Trash2,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Card, EmptyState, LoadingState, PageHeader } from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { LEVEL_LABELS } from "@/features/auth/schema";
import { HealthStatus } from "@/features/health/HealthStatus";
import { listMyTasks } from "@/features/mytasks/api";
import { dueInfo, localToday, type MyTask } from "@/features/mytasks/schema";
import { isOverdue, TaskList } from "@/features/mytasks/TaskList";
import { cn } from "@/lib/cn";

const SHORTCUTS: { href: string; title: string; text: string; icon: LucideIcon }[] = [
  {
    href: "/workspaces",
    title: "Assign a task",
    text: "Open a table, then press Assign task.",
    icon: UserPlus,
  },
  { href: "/my-tasks", title: "My tasks", text: "Everything given to you.", icon: ListChecks },
  { href: "/workspaces", title: "Workspaces", text: "Your bases and tables.", icon: FolderKanban },
  { href: "/trash", title: "Trash", text: "Restore within 30 days.", icon: Trash2 },
];

type Load =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; items: MyTask[]; more: boolean };

/** The tasks to look at first: overdue ones, then today's, then the nearest due dates. */
function upNext(items: MyTask[], today: string): MyTask[] {
  const rank = (task: MyTask): number => {
    if (task.status?.kind === "done") return 4;
    const tone = dueInfo(task.due_date, today)?.tone;
    if (tone === "overdue") return 0;
    if (tone === "today") return 1;
    return task.due_date ? 2 : 3;
  };
  return [...items]
    .sort(
      (a, b) =>
        rank(a) - rank(b) || (a.due_date ?? "￿").localeCompare(b.due_date ?? "￿"),
    )
    .slice(0, 5);
}

function Stat({
  href,
  label,
  value,
  icon: Icon,
  tone,
}: {
  href: string;
  label: string;
  value: string;
  icon: LucideIcon;
  tone: "danger" | "primary" | "neutral";
}) {
  return (
    <li className="relative flex items-center gap-3 rounded-xl border border-line bg-surface p-4 transition-colors hover:border-primary hover:bg-primary-soft/40">
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg",
          tone === "danger" && "bg-danger-soft text-danger",
          tone === "primary" && "bg-primary-soft text-primary",
          tone === "neutral" && "bg-surface-muted text-muted",
        )}
      >
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-2xl font-semibold tracking-tight">{value}</span>
        <Link
          href={href}
          className="text-sm text-muted no-underline after:absolute after:inset-0 hover:text-primary hover:no-underline"
        >
          {label}
        </Link>
      </span>
    </li>
  );
}

/** The first page after signing in: what is due, what is late, and where to go next. */
export function HomeScreen() {
  const { state } = useAuth();
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    listMyTasks("assigned", null, controller.signal)
      .then((page) =>
        setLoad({ kind: "ready", items: page.items, more: page.next_cursor !== null }),
      )
      .catch(() => {
        if (!controller.signal.aborted) setLoad({ kind: "error" });
      });
    return () => controller.abort();
  }, []);

  if (state.status !== "authenticated") return null;
  const { user } = state;
  const today = localToday();
  const day = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const items = load.kind === "ready" ? load.items : [];
  const plus = load.kind === "ready" && load.more ? "+" : "";
  const overdue = items.filter((task) => isOverdue(task, today)).length;
  const dueToday = items.filter(
    (task) => task.status?.kind !== "done" && dueInfo(task.due_date, today)?.tone === "today",
  ).length;
  const open = items.filter((task) => task.status?.kind !== "done").length;
  const value = (n: number) => (load.kind === "ready" ? `${n}${plus}` : "–");

  return (
    <>
      <PageHeader
        title={`Welcome back, ${user.full_name}`}
        description={`${day} · ${LEVEL_LABELS[user.level]}`}
      />
      <div className="grid gap-6">
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3 p-0">
          <Stat
            href="/my-tasks"
            label="Overdue"
            value={value(overdue)}
            icon={AlertTriangle}
            tone={overdue > 0 ? "danger" : "neutral"}
          />
          <Stat
            href="/my-tasks"
            label="Due today"
            value={value(dueToday)}
            icon={CalendarDays}
            tone="primary"
          />
          <Stat
            href="/my-tasks"
            label="Open tasks"
            value={value(open)}
            icon={ListChecks}
            tone="neutral"
          />
        </ul>

        <section aria-label="Up next" className="grid gap-2">
          <div className="flex items-center justify-between">
            <h2 className="m-0 text-base">Up next</h2>
            <Link href="/my-tasks" className="text-sm">
              See all my tasks
            </Link>
          </div>
          {load.kind === "loading" && <LoadingState />}
          {load.kind === "error" && (
            <p className="m-0 text-sm text-muted">Your tasks could not be loaded right now.</p>
          )}
          {load.kind === "ready" && items.length === 0 && (
            <EmptyState icon={Inbox} title="No tasks are assigned to you.">
              Tasks given to you in any table will show up here.
            </EmptyState>
          )}
          {load.kind === "ready" && items.length > 0 && (
            <TaskList items={upNext(items, today)} today={today} />
          )}
        </section>

        <div className="grid items-start gap-5 md:grid-cols-[1fr_16rem]">
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3 p-0">
            {SHORTCUTS.map(({ href, title, text, icon: Icon }) => (
              <li
                key={title}
                className="relative flex items-center gap-3 rounded-lg border border-line bg-surface p-3 transition-colors hover:border-primary hover:bg-primary-soft/40"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded bg-primary-soft text-primary">
                  <Icon className="size-4" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-col leading-tight">
                  <Link
                    href={href}
                    className="font-semibold text-fg no-underline after:absolute after:inset-0 hover:no-underline"
                  >
                    {title}
                  </Link>
                  <span className="text-xs text-muted">{text}</span>
                </span>
              </li>
            ))}
          </ul>
          <Card>
            <h2 className="mt-0 text-sm">System status</h2>
            <HealthStatus />
          </Card>
        </div>
      </div>
    </>
  );
}
