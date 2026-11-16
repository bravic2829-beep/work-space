"use client";

import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  ListTodo,
  UserX,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Alert, Avatar, EmptyState, LoadingState, PageHeader, Select } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { cn } from "@/lib/cn";

import { getOverview, listReportTables, type Overview, type ReportTable } from "./api";

type Tables =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; items: ReportTable[] };

type Report =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: Overview };

const KIND_BAR: Record<string, string> = {
  todo: "bg-line-strong",
  in_progress: "bg-primary",
  review: "bg-warning",
  done: "bg-success",
};

function message(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/**
 * Reports: for one task table, what is late, what waits for review, and who carries what. Every
 * number counts only the tasks the person may open; a number that needs a column hidden from them
 * is shown as "—".
 */
export function ReportsScreen() {
  const [tables, setTables] = useState<Tables>({ kind: "loading" });
  const [tableId, setTableId] = useState<string | null>(null);
  const [report, setReport] = useState<Report>({ kind: "idle" });

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        setTables({ kind: "ready", items: await listReportTables(controller.signal) });
      } catch (error) {
        if (!controller.signal.aborted) {
          setTables({ kind: "error", message: message(error, "Could not load the tables.") });
        }
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  const items = tables.kind === "ready" ? tables.items : [];
  const current = items.find((t) => t.id === tableId)?.id ?? items[0]?.id ?? null;

  useEffect(() => {
    if (!current) return;
    const controller = new AbortController();
    async function load(id: string) {
      try {
        setReport({ kind: "ready", data: await getOverview(id, controller.signal) });
      } catch (error) {
        if (!controller.signal.aborted) {
          setReport({ kind: "error", message: message(error, "Could not load the report.") });
        }
      }
    }
    void load(current);
    return () => controller.abort();
  }, [current]);

  return (
    <>
      <PageHeader
        title="Reports"
        description="What is late, what waits for review, and who carries what. Only tasks you may open are counted."
      />
      {tables.kind === "loading" && <LoadingState>Loading…</LoadingState>}
      {tables.kind === "error" && <Alert>{tables.message}</Alert>}
      {tables.kind === "ready" && items.length === 0 && (
        <EmptyState icon={BarChart3} title="No task table to report on.">
          Reports cover the task tables you can open, through a workspace or a sheet.
        </EmptyState>
      )}
      {tables.kind === "ready" && items.length > 0 && current && (
        <div className="grid gap-5">
          <label className="flex items-center gap-2 text-[13px] font-medium">
            Table
            <Select
              className="h-8 w-auto py-0 text-[13px]"
              value={current}
              onChange={(event) => {
                setTableId(event.target.value);
                setReport({ kind: "loading" });
              }}
            >
              {items.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.workspace_name} / {t.name}
                </option>
              ))}
            </Select>
          </label>
          {(report.kind === "idle" || report.kind === "loading") && (
            <LoadingState>Counting…</LoadingState>
          )}
          {report.kind === "error" && <Alert>{report.message}</Alert>}
          {report.kind === "ready" && <OverviewView data={report.data} />}
        </div>
      )}
    </>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: number | null;
  icon: LucideIcon;
  tone?: "neutral" | "danger" | "warning" | "success" | "info";
}) {
  const hidden = value === null;
  return (
    <li
      className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3"
      title={hidden ? "A column this number needs is hidden from you" : undefined}
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-md",
          tone === "danger" && "bg-danger-soft text-danger",
          tone === "warning" && "bg-warning-soft text-warning",
          tone === "success" && "bg-success-soft text-success",
          tone === "info" && "bg-primary-soft text-primary",
          tone === "neutral" && "bg-surface-muted text-muted",
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-xl font-bold tabular-nums">{hidden ? "—" : value}</span>
        <span className="text-[13px] text-muted">{label}</span>
      </span>
    </li>
  );
}

function OverviewView({ data }: { data: Overview }) {
  const statusTotal = (data.by_status ?? []).reduce((sum, s) => sum + s.count, 0);
  return (
    <div className="grid gap-5">
      <ul aria-label="Totals" className="m-0 grid list-none grid-cols-2 gap-3 p-0 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Open" value={data.open} icon={ListTodo} tone="info" />
        <Stat label="Overdue" value={data.overdue} icon={AlertTriangle} tone="danger" />
        <Stat label="Due today" value={data.due_today} icon={CalendarDays} tone="info" />
        <Stat label="Waiting for review" value={data.in_review} icon={ClipboardCheck} tone="warning" />
        <Stat label="Done" value={data.done} icon={CheckCircle2} tone="success" />
        <Stat label="Unassigned" value={data.unassigned} icon={UserX} />
      </ul>

      {data.by_status && statusTotal > 0 && (
        <section aria-label="By status" className="grid gap-2">
          <h2 className="m-0 text-base">By status</h2>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-muted" aria-hidden>
            {data.by_status.map((s) =>
              s.count > 0 ? (
                <span
                  key={s.name}
                  className={KIND_BAR[s.kind] ?? "bg-line-strong"}
                  style={{ width: `${(s.count / statusTotal) * 100}%` }}
                />
              ) : null,
            )}
          </div>
          <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-1 p-0 text-[13px]">
            {data.by_status.map((s) => (
              <li key={s.name} className="flex items-center gap-1.5">
                <span aria-hidden className={cn("size-2.5 rounded-full", KIND_BAR[s.kind] ?? "bg-line-strong")} />
                {s.name}: <b className="tabular-nums">{s.count}</b>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.people && (
        <section aria-label="Work per person" className="grid gap-2">
          <div className="flex items-baseline justify-between">
            <h2 className="m-0 text-base">Work per person</h2>
            <Link href="/work" className="text-[13px]">
              Open Work summary
            </Link>
          </div>
          {data.people.length === 0 ? (
            <p className="m-0 text-sm text-muted">Nobody has a task in this table yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line bg-surface">
              <table className="m-0">
                <thead>
                  <tr>
                    <th scope="col">Employee</th>
                    <th scope="col" className="text-right">Open</th>
                    <th scope="col" className="text-right">Overdue</th>
                    <th scope="col" className="text-right">Waiting for review</th>
                    <th scope="col" className="text-right">Done</th>
                  </tr>
                </thead>
                <tbody>
                  {data.people.map((p) => (
                    <tr key={p.user_id}>
                      <td>
                        <span className="inline-flex items-center gap-2">
                          <Avatar name={p.full_name} className="size-6 text-[10px]" />
                          {p.full_name}
                          <span className="font-mono text-[11px] text-muted">{p.employee_code}</span>
                        </span>
                      </td>
                      <td className="text-right tabular-nums">{p.open}</td>
                      <td className={cn("text-right tabular-nums", p.overdue > 0 && "font-semibold text-danger")}>
                        {p.overdue}
                      </td>
                      <td className="text-right tabular-nums">{p.in_review}</td>
                      <td className="text-right tabular-nums">{p.done}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      <p className="m-0 text-xs text-muted">
        {data.total} {data.total === 1 ? "task" : "tasks"} in “{data.table_name}” counted on {data.day}.
      </p>
    </div>
  );
}
