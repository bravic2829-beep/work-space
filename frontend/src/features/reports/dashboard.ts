import { localToday } from "@/features/mytasks/schema";
import { apiRequest } from "@/lib/api/client";
import { isRecord } from "@/lib/api/guards";

/** The Overview of Reports, as the server counts it over the tasks the caller may open. */

export type Cards = {
  total: number | null;
  completed: number | null;
  in_progress: number | null;
  overdue: number | null;
  at_risk: number | null;
  blocked: number | null;
  /** 0 to 1; null when no finished task has both a due date and a known completion day. */
  on_time_rate: number | null;
  quality_score: number | null;
};

export type TrendPoint = { week: string; created: number; completed: number };

export type ProjectRow = {
  table_id: string;
  name: string;
  workspace_name: string;
  total: number;
  completed: number;
  overdue: number;
  blocked: number;
};

export type PersonRow = {
  user_id: string;
  full_name: string;
  employee_code: string;
  open: number;
  overdue: number;
  blocked: number;
  done: number;
};

export type OkrSnapshot = {
  cycle_id: string;
  cycle_name: string;
  objectives: number;
  key_results: number;
  progress: number | null;
  at_risk: number;
  off_track: number;
};

export type Dashboard = {
  day: string;
  period_from: string;
  period_to: string;
  cards: Cards;
  trend: TrendPoint[];
  projects: ProjectRow[];
  people: PersonRow[];
  okr: OkrSnapshot | null;
  table_ids: string[];
  truncated: boolean;
};

export const STATUS_KINDS = [
  ["todo", "To do"],
  ["in_progress", "In progress"],
  ["review", "Waiting for review"],
  ["done", "Done"],
  ["paused", "Paused"],
  ["blocked", "Blocked"],
] as const;

export type DashboardFilters = {
  from: string;
  to: string;
  tableId: string;
  personId: string;
  departmentId: string;
  status: string;
};

export const NO_FILTERS: DashboardFilters = {
  from: "",
  to: "",
  tableId: "",
  personId: "",
  departmentId: "",
  status: "",
};

const number = (v: unknown) => typeof v === "number";
const maybe = (v: unknown) => v === null || typeof v === "number";
const strings = (v: unknown, keys: string[]) => isRecord(v) && keys.every((k) => typeof v[k] === "string");

function isCards(value: unknown): value is Cards {
  return (
    isRecord(value) &&
    ["total", "completed", "in_progress", "overdue", "at_risk", "blocked", "on_time_rate", "quality_score"].every(
      (k) => maybe(value[k]),
    )
  );
}

function isTrend(value: unknown): value is TrendPoint {
  return isRecord(value) && typeof value.week === "string" && number(value.created) && number(value.completed);
}

function isProject(value: unknown): value is ProjectRow {
  return (
    strings(value, ["table_id", "name", "workspace_name"]) &&
    ["total", "completed", "overdue", "blocked"].every((k) => number((value as Record<string, unknown>)[k]))
  );
}

function isPerson(value: unknown): value is PersonRow {
  return (
    strings(value, ["user_id", "full_name", "employee_code"]) &&
    ["open", "overdue", "blocked", "done"].every((k) => number((value as Record<string, unknown>)[k]))
  );
}

function isOkr(value: unknown): value is OkrSnapshot {
  return (
    strings(value, ["cycle_id", "cycle_name"]) &&
    ["objectives", "key_results", "at_risk", "off_track"].every((k) => number((value as Record<string, unknown>)[k])) &&
    maybe((value as Record<string, unknown>).progress)
  );
}

export function isDashboard(value: unknown): value is Dashboard {
  return (
    isRecord(value) &&
    strings(value, ["day", "period_from", "period_to"]) &&
    isCards(value.cards) &&
    Array.isArray(value.trend) &&
    value.trend.every(isTrend) &&
    Array.isArray(value.projects) &&
    value.projects.every(isProject) &&
    Array.isArray(value.people) &&
    value.people.every(isPerson) &&
    (value.okr === null || isOkr(value.okr)) &&
    Array.isArray(value.table_ids) &&
    value.table_ids.every((id) => typeof id === "string") &&
    typeof value.truncated === "boolean"
  );
}

export function getDashboard(filters: DashboardFilters, signal?: AbortSignal): Promise<Dashboard> {
  const params = new URLSearchParams({ date: localToday() });
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.tableId) params.set("table_id", filters.tableId);
  if (filters.personId) params.set("person", filters.personId);
  if (filters.departmentId) params.set("department_id", filters.departmentId);
  if (filters.status) params.set("status", filters.status);
  return apiRequest("GET", `/api/v1/reports/dashboard?${params.toString()}`, {
    guard: isDashboard,
    signal,
  });
}
