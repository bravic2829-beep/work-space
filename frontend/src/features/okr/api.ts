import { API, apiRequest } from "@/lib/api/client";

import {
  isCheckInList,
  isCycle,
  isCycleList,
  isObjective,
  isOkrDepartmentList,
  isOverview,
  type CheckIn,
  type Cycle,
  type KrStatus,
  type Objective,
  type OkrDepartment,
  type OkrLevel,
  type Overview,
} from "./schema";

const BASE = `${API}/okr`;

export function changeTaskLink(krId: string, recordId: string, attach: boolean): Promise<void> {
  return apiRequest(attach ? "POST" : "DELETE", `${BASE}/key-results/${krId}/tasks/${recordId}`);
}

// --- cycles ----------------------------------------------------------------------------------------

export function listCycles(signal?: AbortSignal): Promise<Cycle[]> {
  return apiRequest("GET", `${BASE}/cycles`, { guard: isCycleList, signal });
}

export type CycleInput = { name: string; starts_on: string; ends_on: string };

export function createCycle(body: CycleInput): Promise<Cycle> {
  return apiRequest("POST", `${BASE}/cycles`, { body, guard: isCycle });
}

export function updateCycle(
  id: string,
  body: Partial<CycleInput> & { status?: "open" | "closed" },
): Promise<Cycle> {
  return apiRequest("PATCH", `${BASE}/cycles/${id}`, { body, guard: isCycle });
}

export function deleteCycle(id: string): Promise<void> {
  return apiRequest("DELETE", `${BASE}/cycles/${id}`);
}

// --- the overview -------------------------------------------------------------------------------------

export type OverviewQuery = {
  cycleId: string;
  /** Keep only the key results in these states (the "at risk" view). */
  krStatus?: KrStatus[];
  level?: OkrLevel | null;
  /** Keep what the person owns or works on. */
  mine?: boolean;
};

function overviewParams(query: OverviewQuery): URLSearchParams {
  const params = new URLSearchParams({ cycle_id: query.cycleId });
  for (const status of query.krStatus ?? []) params.append("kr_status", status);
  if (query.level) params.set("level", query.level);
  if (query.mine) params.set("mine", "true");
  return params;
}

export function exportOverviewUrl(query: OverviewQuery): string {
  return `${BASE}/export?${overviewParams(query)}`;
}

export function getOverview(query: OverviewQuery, signal?: AbortSignal): Promise<Overview> {
  return apiRequest("GET", `${BASE}/overview?${overviewParams(query)}`, {
    guard: isOverview,
    signal,
  });
}

export function listOkrDepartments(signal?: AbortSignal): Promise<OkrDepartment[]> {
  return apiRequest("GET", `${BASE}/departments`, { guard: isOkrDepartmentList, signal });
}

// --- objectives and key results ----------------------------------------------------------------------------

export type ObjectiveInput = {
  title: string;
  description?: string | null;
  owner_id?: string;
  level: OkrLevel;
  department_id?: string | null;
  parent_id?: string | null;
  is_private?: boolean;
};

export function createObjective(
  body: ObjectiveInput & { cycle_id: string },
): Promise<Objective> {
  return apiRequest("POST", `${BASE}/objectives`, { body, guard: isObjective });
}

export function updateObjective(id: string, body: Partial<ObjectiveInput>): Promise<Objective> {
  return apiRequest("PATCH", `${BASE}/objectives/${id}`, { body, guard: isObjective });
}

export function deleteObjective(id: string): Promise<void> {
  return apiRequest("DELETE", `${BASE}/objectives/${id}`);
}

export type KeyResultInput = {
  title: string;
  owner_id?: string;
  unit: string;
  start_value: number;
  target_value: number;
};

export function createKeyResult(objectiveId: string, body: KeyResultInput): Promise<Objective> {
  return apiRequest("POST", `${BASE}/objectives/${objectiveId}/key-results`, {
    body,
    guard: isObjective,
  });
}

export function updateKeyResult(id: string, body: Partial<KeyResultInput>): Promise<Objective> {
  return apiRequest("PATCH", `${BASE}/key-results/${id}`, { body, guard: isObjective });
}

export function deleteKeyResult(id: string): Promise<void> {
  return apiRequest("DELETE", `${BASE}/key-results/${id}`);
}

// --- check-ins and the review ---------------------------------------------------------------------------------

export type CheckInInput = { value: number; status?: KrStatus; note?: string };

export function checkIn(keyResultId: string, body: CheckInInput): Promise<Objective> {
  return apiRequest("POST", `${BASE}/key-results/${keyResultId}/check-ins`, {
    body,
    guard: isObjective,
  });
}

export function listCheckIns(keyResultId: string, signal?: AbortSignal): Promise<CheckIn[]> {
  return apiRequest("GET", `${BASE}/key-results/${keyResultId}/check-ins`, {
    guard: isCheckInList,
    signal,
  });
}

export type ReviewInput = { score?: number | null; merits?: string | null; to_improve?: string | null };

export function reviewObjective(id: string, body: ReviewInput): Promise<Objective> {
  return apiRequest("PATCH", `${BASE}/objectives/${id}/review`, { body, guard: isObjective });
}

export function reviewKeyResult(id: string, body: ReviewInput): Promise<Objective> {
  return apiRequest("PATCH", `${BASE}/key-results/${id}/review`, { body, guard: isObjective });
}
