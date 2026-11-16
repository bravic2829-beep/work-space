import { localToday } from "@/features/mytasks/schema";
import { apiRequest } from "@/lib/api/client";

export type ReportTable = { id: string; name: string; workspace_name: string };

export type StatusCount = { kind: string; name: string; count: number };

export type PersonLoad = {
  user_id: string;
  full_name: string;
  employee_code: string;
  open: number;
  overdue: number;
  in_review: number;
  done: number;
};

/** Counts over the tasks the caller may open. Null: the column it needs is hidden from them. */
export type Overview = {
  table_id: string;
  table_name: string;
  day: string;
  total: number;
  open: number | null;
  in_review: number | null;
  done: number | null;
  overdue: number | null;
  due_today: number | null;
  unassigned: number | null;
  by_status: StatusCount[] | null;
  people: PersonLoad[] | null;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const count = (value: unknown) => value === null || typeof value === "number";

export function isReportTables(value: unknown): value is ReportTable[] {
  return (
    Array.isArray(value) &&
    value.every(
      (t) =>
        isObject(t) &&
        typeof t.id === "string" &&
        typeof t.name === "string" &&
        typeof t.workspace_name === "string",
    )
  );
}

function isPerson(value: unknown): value is PersonLoad {
  return (
    isObject(value) &&
    typeof value.user_id === "string" &&
    typeof value.full_name === "string" &&
    typeof value.employee_code === "string" &&
    ["open", "overdue", "in_review", "done"].every((k) => typeof value[k] === "number")
  );
}

export function isOverview(value: unknown): value is Overview {
  return (
    isObject(value) &&
    typeof value.table_id === "string" &&
    typeof value.table_name === "string" &&
    typeof value.day === "string" &&
    typeof value.total === "number" &&
    ["open", "in_review", "done", "overdue", "due_today", "unassigned"].every((k) =>
      count(value[k]),
    ) &&
    (value.by_status === null ||
      (Array.isArray(value.by_status) &&
        value.by_status.every(
          (s) =>
            isObject(s) &&
            typeof s.kind === "string" &&
            typeof s.name === "string" &&
            typeof s.count === "number",
        ))) &&
    (value.people === null || (Array.isArray(value.people) && value.people.every(isPerson)))
  );
}

export function listReportTables(signal?: AbortSignal): Promise<ReportTable[]> {
  return apiRequest("GET", "/api/v1/reports/tables", { guard: isReportTables, signal });
}

export function getOverview(tableId: string, signal?: AbortSignal): Promise<Overview> {
  const params = new URLSearchParams({ table_id: tableId, date: localToday() });
  return apiRequest("GET", `/api/v1/reports/overview?${params.toString()}`, {
    guard: isOverview,
    signal,
  });
}
