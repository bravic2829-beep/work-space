import type { Condition, FieldItem, ViewTotal } from "./schema";
import { fieldBySemantic } from "./taskWorkflow";

/**
 * The ready-made filters behind the numbers of the Reports page: clicking "Overdue 5" opens the
 * table with the filter that shows exactly those tasks. They are ordinary filter conditions, so
 * the person can change or clear them like any other filter.
 */
export const PRESETS = [
  "open",
  "overdue",
  "due_today",
  "review",
  "done",
  "unassigned",
  "blocked",
  "paused",
] as const;

export type Preset = (typeof PRESETS)[number];

export function isPreset(value: unknown): value is Preset {
  return typeof value === "string" && (PRESETS as readonly string[]).includes(value);
}

const LABELS: Record<Preset, string> = {
  open: "Open tasks",
  overdue: "Overdue tasks",
  due_today: "Tasks due today",
  review: "Tasks waiting for review",
  done: "Done tasks",
  unassigned: "Unassigned tasks",
  blocked: "Blocked tasks",
  paused: "Paused tasks",
};

export type PresetResult = { filter: Condition[]; label: string };

/** The ids of the options of a status column that have this kind. */
function optionsOfKind(status: FieldItem, kind: string): string[] {
  const options = status.config.options;
  if (!Array.isArray(options)) return [];
  return options
    .filter(
      (o): o is { id: string; kind: string } =>
        typeof o === "object" && o !== null && (o as { kind?: unknown }).kind === kind,
    )
    .map((o) => o.id);
}

/**
 * The filter for a preset, or null when this table has no column or option it needs (then the
 * table opens unfiltered). `person` narrows the tasks to the ones assigned to that person.
 * "Open" means not done, the same rule as the report: a task with no status yet is open.
 */
export function presetFilter(
  preset: Preset,
  fields: FieldItem[],
  today: string,
  person?: string | null,
): PresetResult | null {
  const status = fieldBySemantic(fields, "status");
  const due = fieldBySemantic(fields, "due_date");
  const assignee = fieldBySemantic(fields, "assignee");
  const filter: Condition[] = [];

  const notDone = (): boolean => {
    if (!status) return false;
    for (const id of optionsOfKind(status, "done")) {
      filter.push({ field: status.id, op: "neq", value: id });
    }
    return true;
  };
  const onlyKind = (kind: string): boolean => {
    if (!status) return false;
    const ids = optionsOfKind(status, kind);
    if (ids.length === 0) return false;
    filter.push({ field: status.id, op: "in", value: ids });
    return true;
  };

  let ok: boolean;
  switch (preset) {
    case "open":
      ok = notDone();
      break;
    case "overdue":
      ok = due !== undefined && notDone();
      if (ok && due) filter.push({ field: due.id, op: "lt", value: today });
      break;
    case "due_today":
      ok = due !== undefined && notDone();
      if (ok && due) filter.push({ field: due.id, op: "eq", value: today });
      break;
    case "review":
      ok = onlyKind("review");
      break;
    case "done":
      ok = onlyKind("done");
      break;
    case "blocked":
      ok = onlyKind("blocked");
      break;
    case "paused":
      ok = onlyKind("paused");
      break;
    case "unassigned":
      ok = assignee !== undefined;
      if (assignee) filter.push({ field: assignee.id, op: "is_empty" });
      break;
  }
  if (!ok) return null;

  if (person && assignee && preset !== "unassigned") {
    filter.push({ field: assignee.id, op: "contains", value: person });
  }
  return { filter, label: LABELS[preset] };
}

/**
 * The three tabs of the Reports page, each a ready-made way to look at a task table: a summary
 * folded under the parent task, the tasks at risk (blocked or paused) under their assignee, and the
 * review of the work (score and notes) with the average score of each parent task.
 */
export const REPORT_VIEWS = ["summary", "risk", "review"] as const;
export type ReportView = (typeof REPORT_VIEWS)[number];

export const REPORT_VIEW_LABELS: Record<ReportView, string> = {
  summary: "Summary",
  risk: "At risk",
  review: "Review",
};

export type ReportViewConfig = {
  filter: Condition[];
  groupBy: string | null;
  totals: ViewTotal[];
};

/**
 * What a report tab sets on the table: its filter, the column it groups by and its totals. The
 * columns are found by their role, so it works on any task table; whatever the table lacks is
 * left out (no parent column: grouped by status instead; no review score: no total).
 */
export function reportViewConfig(kind: ReportView, fields: FieldItem[]): ReportViewConfig {
  const status = fieldBySemantic(fields, "status");
  const parent = fieldBySemantic(fields, "parent");
  const assignee = fieldBySemantic(fields, "assignee");
  const score = fieldBySemantic(fields, "review_score");
  const totals: ViewTotal[] = score ? [{ field: score.id, fn: "avg" }] : [];

  if (kind === "risk") {
    const held = status
      ? [...optionsOfKind(status, "blocked"), ...optionsOfKind(status, "paused")]
      : [];
    return {
      filter: status && held.length > 0 ? [{ field: status.id, op: "in", value: held }] : [],
      groupBy: (assignee ?? status)?.id ?? null,
      totals: [],
    };
  }
  return {
    filter: [],
    groupBy: (parent ?? status)?.id ?? null,
    totals: kind === "review" ? totals : [],
  };
}
