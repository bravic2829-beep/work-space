"use client";

import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Gauge,
  ListChecks,
  ListTodo,
  OctagonAlert,
  ShieldAlert,
  Star,
  Target,
  Timer,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import {
  Alert,
  Avatar,
  EmptyState,
  Input,
  LoadingState,
  Select,
  StatCard,
} from "@/components/ui";
import { listOkrDepartments } from "@/features/okr/api";
import { percent } from "@/features/okr/schema";
import type { Preset } from "@/features/tables/presets";
import { cn } from "@/lib/cn";
import { useApiResource } from "@/lib/useApiResource";

import { getDashboard, NO_FILTERS, STATUS_KINDS, type Dashboard, type DashboardFilters } from "./dashboard";
import { listReportTables } from "./api";
import { TrendChart } from "./TrendChart";

const HIDDEN_HINT = "A column this number needs is hidden from you";

function tableLink(tableId: string, show?: Preset, person?: string): string {
  const params = new URLSearchParams();
  if (show) params.set("show", show);
  if (person) params.set("person", person);
  const query = params.toString();
  return `/tables/${tableId}${query ? `?${query}` : ""}`;
}

function Count({ value, href, danger }: { value: number; href: string; danger?: boolean }) {
  if (value === 0) return <span className="tabular-nums">{value}</span>;
  return (
    <Link href={href} className={cn("tabular-nums", danger && "font-semibold text-danger")}>
      {value}
    </Link>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-[12px] font-medium text-muted">
      {label}
      {children}
    </label>
  );
}

/**
 * The Overview: ten numbers for the tasks and the OKR, how many tasks were created and completed
 * each week, and the work per project and per person. Every number counts only what the person
 * may open; with one table in scope the cards lead to the tasks that were counted.
 */
export function OverviewScreen() {
  const [filters, setFilters] = useState<DashboardFilters>(NO_FILTERS);
  const tables = useApiResource(listReportTables, "Could not load the tables.", []);
  const departments = useApiResource(listOkrDepartments, "Could not load the departments.", []);
  const result = useApiResource(
    (signal) => getDashboard(filters, signal),
    "Could not load the overview.",
    [filters],
  );

  // The people to choose from are the ones seen while nothing narrowed the list.
  const [known, setKnown] = useState<Map<string, string>>(new Map());
  const [seen, setSeen] = useState<Dashboard | null>(null);
  const data = result.kind === "ready" ? result.data : null;
  if (data && data !== seen) {
    setSeen(data);
    if (!filters.personId && !filters.departmentId && !filters.status) {
      const next = new Map(known);
      for (const p of data.people) next.set(p.user_id, p.full_name);
      setKnown(next);
    }
  }

  const set = (patch: Partial<DashboardFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const narrowed = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  const people = [...known.entries()].sort((a, b) => a[1].localeCompare(b[1]));

  return (
    <div className="grid gap-5">
      <section aria-label="Filters" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Field label="From">
          <Input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => set({ from: e.target.value })} />
        </Field>
        <Field label="To">
          <Input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => set({ to: e.target.value })} />
        </Field>
        <Field label="Project">
          <Select value={filters.tableId} onChange={(e) => set({ tableId: e.target.value })}>
            <option value="">All projects</option>
            {(tables.kind === "ready" ? tables.data : []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.workspace_name} / {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Department">
          <Select value={filters.departmentId} onChange={(e) => set({ departmentId: e.target.value })}>
            <option value="">All departments</option>
            {(departments.kind === "ready" ? departments.data : []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Employee">
          <Select value={filters.personId} onChange={(e) => set({ personId: e.target.value })}>
            <option value="">Everyone</option>
            {people.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={filters.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="">Any status</option>
            {STATUS_KINDS.map(([kind, label]) => (
              <option key={kind} value={kind}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      </section>
      {narrowed && (
        <div>
          <button
            type="button"
            onClick={() => setFilters(NO_FILTERS)}
            className="text-[13px] text-primary underline-offset-2 hover:underline"
          >
            Clear filters
          </button>
        </div>
      )}

      {result.kind === "loading" && <LoadingState>Counting…</LoadingState>}
      {result.kind === "error" && <Alert>{result.message}</Alert>}
      {data && <OverviewBody data={data} personId={filters.personId} />}
    </div>
  );
}

function OverviewBody({ data, personId }: { data: Dashboard; personId: string }) {
  const { cards, okr } = data;
  // The cards lead to a table only when there is exactly one in scope.
  const only = data.table_ids.length === 1 ? data.table_ids[0] : null;
  const link = (show: Preset) => (only ? tableLink(only, show, personId || undefined) : undefined);

  if (data.table_ids.length === 0 && !okr) {
    return (
      <EmptyState icon={BarChart3} title="Nothing to report on yet.">
        The overview covers the task tables you can open and the OKR of the current cycle.
      </EmptyState>
    );
  }

  return (
    <div className="grid gap-5">
      {data.truncated && (
        <Alert>There are more tasks than the page can count. The numbers cover the first 50,000.</Alert>
      )}
      <ul aria-label="Key numbers" className="m-0 grid list-none grid-cols-2 gap-3 p-0 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label={okr ? `Objectives · ${okr.cycle_name}` : "Objectives"} value={okr ? okr.objectives : null} icon={Target} tone="info" unavailableHint="No OKR cycle yet" />
        <StatCard label="Key results" value={okr ? okr.key_results : null} icon={ListChecks} tone="info" unavailableHint="No OKR cycle yet" />
        <StatCard label="OKR progress" value={okr && okr.progress !== null ? percent(okr.progress) : null} icon={TrendingUp} tone="success" unavailableHint="No key result has a measure yet" />
        <StatCard unavailableHint={HIDDEN_HINT} label="Tasks completed" value={cards.completed} icon={CheckCircle2} tone="success" href={link("done")} />
        <StatCard unavailableHint={HIDDEN_HINT} label="Tasks in progress" value={cards.in_progress} icon={ListTodo} tone="info" href={link("open")} />
        <StatCard unavailableHint={HIDDEN_HINT} label="Overdue tasks" value={cards.overdue} icon={AlertTriangle} tone="danger" href={link("overdue")} />
        <StatCard unavailableHint={HIDDEN_HINT} label="At risk" value={cards.at_risk} icon={ShieldAlert} tone="warning" />
        <StatCard unavailableHint={HIDDEN_HINT} label="Blocked tasks" value={cards.blocked} icon={OctagonAlert} tone="danger" href={link("blocked")} />
        <StatCard
          unavailableHint="Needs a finished task with a due date"
          label="On-time rate"
          value={cards.on_time_rate === null ? null : percent(cards.on_time_rate)}
          icon={Timer}
          tone="success"
        />
        <StatCard
          unavailableHint="Not measured yet: it needs the quality review"
          label="Quality score"
          value={cards.quality_score === null ? null : Math.round(cards.quality_score)}
          icon={Star}
        />
      </ul>
      <p className="m-0 text-xs text-muted">
        Tasks due, finished or (with no due date) created between {data.period_from} and {data.period_to}: {cards.total ?? "—"} in all.
        {" "}At risk means blocked, or due within two days. On-time rate counts finished tasks that have a due date.
        {okr && okr.at_risk + okr.off_track > 0 && (
          <> {okr.at_risk + okr.off_track} key results are at risk or off track.</>
        )}
      </p>

      <section aria-label="Trend" className="grid gap-2">
        <h2 className="m-0 flex items-center gap-2 text-base">
          <Gauge className="size-4 text-muted" aria-hidden /> Created and completed each week
        </h2>
        {data.trend.length === 0 ? (
          <p className="m-0 text-sm text-muted">No week to show for this period.</p>
        ) : (
          <TrendChart points={data.trend} />
        )}
      </section>

      <section aria-label="Work per project" className="grid gap-2">
        <h2 className="m-0 text-base">Work per project</h2>
        {data.projects.length === 0 ? (
          <p className="m-0 text-sm text-muted">No task table matches.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="m-0">
              <thead>
                <tr>
                  <th scope="col">Project</th>
                  <th scope="col" className="text-right">Tasks</th>
                  <th scope="col" className="text-right">Completed</th>
                  <th scope="col" className="text-right">Overdue</th>
                  <th scope="col" className="text-right">Blocked</th>
                </tr>
              </thead>
              <tbody>
                {data.projects.map((p) => (
                  <tr key={p.table_id}>
                    <td>
                      <Link href={tableLink(p.table_id)}>{p.name}</Link>
                      <span className="ml-2 text-[11px] text-muted">{p.workspace_name}</span>
                    </td>
                    <td className="text-right"><Count value={p.total} href={tableLink(p.table_id)} /></td>
                    <td className="text-right"><Count value={p.completed} href={tableLink(p.table_id, "done")} /></td>
                    <td className="text-right"><Count value={p.overdue} href={tableLink(p.table_id, "overdue")} danger /></td>
                    <td className="text-right"><Count value={p.blocked} href={tableLink(p.table_id, "blocked")} danger /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {data.people.length > 0 && (
        <section aria-label="Work per employee" className="grid gap-2">
          <h2 className="m-0 text-base">Work per employee</h2>
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="m-0">
              <thead>
                <tr>
                  <th scope="col">Employee</th>
                  <th scope="col" className="text-right">Open</th>
                  <th scope="col" className="text-right">Overdue</th>
                  <th scope="col" className="text-right">Blocked</th>
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
                    <td className={cn("text-right tabular-nums", p.overdue > 0 && "font-semibold text-danger")}>{p.overdue}</td>
                    <td className={cn("text-right tabular-nums", p.blocked > 0 && "font-semibold text-danger")}>{p.blocked}</td>
                    <td className="text-right tabular-nums">{p.done}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
