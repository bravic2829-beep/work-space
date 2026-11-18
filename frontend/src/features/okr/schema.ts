import { isArrayOf, isRecord } from "@/lib/api/guards";

export type OkrLevel = "company" | "department" | "personal";
export type KrStatus = "on_track" | "at_risk" | "off_track";
export type CycleStatus = "open" | "closed";

export const LEVELS: readonly OkrLevel[] = ["company", "department", "personal"];
export const STATUSES: readonly KrStatus[] = ["on_track", "at_risk", "off_track"];

export const LEVEL_LABELS: Record<OkrLevel, string> = {
  company: "Company",
  department: "Department",
  personal: "Personal",
};

export const STATUS_LABELS: Record<KrStatus, string> = {
  on_track: "On track",
  at_risk: "At risk",
  off_track: "Off track",
};

export type UserRef = { id: string; full_name: string; employee_code: string };

export type Cycle = {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  status: CycleStatus;
  created_at: string;
};

export type KeyResult = {
  id: string;
  objective_id: string;
  title: string;
  owner: UserRef;
  unit: string;
  start_value: number;
  target_value: number;
  current_value: number;
  /** 0 to 1, worked out by the server from the three values. */
  progress: number;
  status: KrStatus;
  score: number | null;
  merits: string | null;
  to_improve: string | null;
  position: number;
  updated_at: string;
  last_check_in_at: string | null;
  can_check_in: boolean;
  tasks?: { id: string; table_id: string; title: string | null }[];
};

export type Objective = {
  id: string;
  cycle_id: string;
  title: string;
  description: string | null;
  owner: UserRef;
  level: OkrLevel;
  department: { id: string; name: string } | null;
  parent_id: string | null;
  is_private: boolean;
  /** The average of its key results, 0 to 1; null while it has none. */
  progress: number | null;
  score: number | null;
  merits: string | null;
  to_improve: string | null;
  position: number;
  can_edit: boolean;
  can_review: boolean;
  key_results: KeyResult[];
};

export type OverviewSummary = {
  objectives: number;
  key_results: number;
  progress: number | null;
  on_track: number;
  at_risk: number;
  off_track: number;
  reviewed: number;
};

export type Overview = { cycle: Cycle; objectives: Objective[]; summary: OverviewSummary };

export type CheckIn = {
  id: string;
  key_result_id: string;
  author: UserRef;
  value: number;
  status: KrStatus;
  note: string | null;
  created_at: string;
};

export type OkrDepartment = { id: string; name: string; can_create: boolean };

const orNull = (guard: (v: unknown) => boolean) => (value: unknown) =>
  value === null || guard(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number => typeof value === "number";
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const oneOf = (values: readonly string[]) => (value: unknown) =>
  typeof value === "string" && values.includes(value);

function isUserRef(value: unknown): value is UserRef {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.full_name) &&
    isString(value.employee_code)
  );
}

export function isCycle(value: unknown): value is Cycle {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    isString(value.starts_on) &&
    isString(value.ends_on) &&
    oneOf(["open", "closed"])(value.status) &&
    isString(value.created_at)
  );
}
export const isCycleList = isArrayOf(isCycle);

function isKeyResult(value: unknown): value is KeyResult {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.objective_id) &&
    isString(value.title) &&
    isUserRef(value.owner) &&
    isString(value.unit) &&
    isNumber(value.start_value) &&
    isNumber(value.target_value) &&
    isNumber(value.current_value) &&
    isNumber(value.progress) &&
    oneOf(STATUSES)(value.status) &&
    orNull(isNumber)(value.score) &&
    orNull(isString)(value.merits) &&
    orNull(isString)(value.to_improve) &&
    isNumber(value.position) &&
    isString(value.updated_at) &&
    orNull(isString)(value.last_check_in_at) &&
    isBoolean(value.can_check_in) &&
    (value.tasks === undefined || isArrayOf((task): task is NonNullable<KeyResult["tasks"]>[number] =>
      isRecord(task) && isString(task.id) && isString(task.table_id) && orNull(isString)(task.title),
    )(value.tasks))
  );
}

export function isObjective(value: unknown): value is Objective {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.cycle_id) &&
    isString(value.title) &&
    orNull(isString)(value.description) &&
    isUserRef(value.owner) &&
    oneOf(LEVELS)(value.level) &&
    orNull((d) => isRecord(d) && isString(d.id) && isString(d.name))(value.department) &&
    orNull(isString)(value.parent_id) &&
    isBoolean(value.is_private) &&
    orNull(isNumber)(value.progress) &&
    orNull(isNumber)(value.score) &&
    orNull(isString)(value.merits) &&
    orNull(isString)(value.to_improve) &&
    isNumber(value.position) &&
    isBoolean(value.can_edit) &&
    isBoolean(value.can_review) &&
    isArrayOf(isKeyResult)(value.key_results)
  );
}

export function isOverview(value: unknown): value is Overview {
  if (!isRecord(value) || !isRecord(value.summary)) return false;
  const s = value.summary;
  return (
    isCycle(value.cycle) &&
    isArrayOf(isObjective)(value.objectives) &&
    ["objectives", "key_results", "on_track", "at_risk", "off_track", "reviewed"].every((k) =>
      isNumber(s[k]),
    ) &&
    orNull(isNumber)(s.progress)
  );
}

function isCheckIn(value: unknown): value is CheckIn {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.key_result_id) &&
    isUserRef(value.author) &&
    isNumber(value.value) &&
    oneOf(STATUSES)(value.status) &&
    orNull(isString)(value.note) &&
    isString(value.created_at)
  );
}
export const isCheckInList = isArrayOf(isCheckIn);

function isOkrDepartment(value: unknown): value is OkrDepartment {
  return (
    isRecord(value) && isString(value.id) && isString(value.name) && isBoolean(value.can_create)
  );
}
export const isOkrDepartmentList = isArrayOf(isOkrDepartment);

// --- how the numbers are written ---------------------------------------------------------------------

/** 0.756 as "76%". An objective with no key results has no progress: a dash. */
export function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

const NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** A value with its unit: "120 customers", "45 %", "1,200 $". */
export function formatValue(value: number, unit: string): string {
  return unit ? `${NUMBER.format(value)} ${unit}` : NUMBER.format(value);
}

/** "0.8", one decimal; no score yet: a dash. */
export function scoreText(score: number | null): string {
  return score === null ? "—" : score.toFixed(1);
}

/** The average of the scores that exist, or null. */
export function averageScore(objective: Objective): number | null {
  const scores = objective.key_results.map((kr) => kr.score).filter((s): s is number => s !== null);
  return scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
}
