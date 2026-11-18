import { isRecord } from "@/lib/api/guards";

/** Performance: the criteria people are judged on, and the score of each person for a month. */

export type MetricId =
  | "completion_rate"
  | "on_time_rate"
  | "overdue_rate"
  | "rework_rate"
  | "blocked_tasks"
  | "update_compliance";

export const METRIC_IDS: readonly string[] = [
  "completion_rate",
  "on_time_rate",
  "overdue_rate",
  "rework_rate",
  "blocked_tasks",
  "update_compliance",
];

export type Criterion = {
  id: string;
  name: string;
  description: string | null;
  weight: number;
  /** Null: scored by a person. */
  metric: MetricId | null;
  is_active: boolean;
  position: number;
};

export type MetricInfo = { id: MetricId; label: string; description: string; measurable: boolean };

export type Criteria = {
  criteria: Criterion[];
  total_weight: number;
  can_manage: boolean;
  metrics: MetricInfo[];
};

export type CriterionChange = {
  id: string;
  actor_name: string;
  changes: Record<string, unknown>;
  reason: string | null;
  created_at: string;
};

export type CriterionScore = {
  criterion_id: string;
  /** 0 to 100; null: nothing to judge (never a zero). */
  score: number | null;
  source: "auto" | "manual" | "none";
  detail: string;
  reason: string | null;
};

export type PersonScore = {
  user_id: string;
  full_name: string;
  employee_code: string;
  scores: CriterionScore[];
  total: number | null;
  /** The share of the active weight that had a score, 0 to 1. */
  coverage: number;
  can_score: boolean;
};

export type Scores = { period: string; criteria: Criterion[]; people: PersonScore[] };

const orNull = (guard: (v: unknown) => boolean) => (v: unknown) => v === null || guard(v);
const isString = (v: unknown) => typeof v === "string";
const isNumber = (v: unknown) => typeof v === "number";

export function isCriterion(value: unknown): value is Criterion {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    orNull(isString)(value.description) &&
    typeof value.weight === "number" &&
    (value.metric === null || METRIC_IDS.includes(value.metric as string)) &&
    typeof value.is_active === "boolean" &&
    typeof value.position === "number"
  );
}

function isMetricInfo(value: unknown): value is MetricInfo {
  return (
    isRecord(value) &&
    METRIC_IDS.includes(value.id as string) &&
    typeof value.label === "string" &&
    typeof value.description === "string" &&
    typeof value.measurable === "boolean"
  );
}

export function isCriteria(value: unknown): value is Criteria {
  return (
    isRecord(value) &&
    Array.isArray(value.criteria) &&
    value.criteria.every(isCriterion) &&
    typeof value.total_weight === "number" &&
    typeof value.can_manage === "boolean" &&
    Array.isArray(value.metrics) &&
    value.metrics.every(isMetricInfo)
  );
}

export function isChangeList(value: unknown): value is CriterionChange[] {
  return (
    Array.isArray(value) &&
    value.every(
      (c) =>
        isRecord(c) &&
        typeof c.id === "string" &&
        typeof c.actor_name === "string" &&
        isRecord(c.changes) &&
        orNull(isString)(c.reason) &&
        typeof c.created_at === "string",
    )
  );
}

function isCriterionScore(value: unknown): value is CriterionScore {
  return (
    isRecord(value) &&
    typeof value.criterion_id === "string" &&
    orNull(isNumber)(value.score) &&
    (value.source === "auto" || value.source === "manual" || value.source === "none") &&
    typeof value.detail === "string" &&
    (value.reason === undefined || orNull(isString)(value.reason))
  );
}

function isPersonScore(value: unknown): value is PersonScore {
  return (
    isRecord(value) &&
    typeof value.user_id === "string" &&
    typeof value.full_name === "string" &&
    typeof value.employee_code === "string" &&
    Array.isArray(value.scores) &&
    value.scores.every(isCriterionScore) &&
    orNull(isNumber)(value.total) &&
    typeof value.coverage === "number" &&
    typeof value.can_score === "boolean"
  );
}

export function isScores(value: unknown): value is Scores {
  return (
    isRecord(value) &&
    typeof value.period === "string" &&
    Array.isArray(value.criteria) &&
    value.criteria.every(isCriterion) &&
    Array.isArray(value.people) &&
    value.people.every(isPersonScore)
  );
}

/** "2026-11" for a date. */
export function monthOf(day: Date): string {
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}`;
}
