import { localToday } from "@/features/mytasks/schema";
import { API, apiRequest } from "@/lib/api/client";

import {
  isChangeList,
  isCriteria,
  isCriterion,
  isScores,
  type Criteria,
  type Criterion,
  type CriterionChange,
  type MetricId,
  type Scores,
} from "./schema";

const BASE = `${API}/performance`;

export function getCriteria(signal?: AbortSignal): Promise<Criteria> {
  return apiRequest("GET", `${BASE}/criteria`, { guard: isCriteria, signal });
}

export type CriterionInput = {
  name: string;
  description?: string | null;
  weight: number;
  metric: MetricId | null;
};

export function createCriterion(body: CriterionInput): Promise<Criterion> {
  return apiRequest("POST", `${BASE}/criteria`, { body, guard: isCriterion });
}

export function updateCriterion(
  id: string,
  body: Partial<CriterionInput> & { is_active?: boolean; reason?: string },
): Promise<Criterion> {
  return apiRequest("PATCH", `${BASE}/criteria/${id}`, { body, guard: isCriterion });
}

export function getHistory(id: string, signal?: AbortSignal): Promise<CriterionChange[]> {
  return apiRequest("GET", `${BASE}/criteria/${id}/history`, { guard: isChangeList, signal });
}

export function getScores(
  query: { period: string; departmentId: string },
  signal?: AbortSignal,
): Promise<Scores> {
  const params = new URLSearchParams({ period: query.period, date: localToday() });
  if (query.departmentId) params.set("department_id", query.departmentId);
  return apiRequest("GET", `${BASE}/scores?${params.toString()}`, { guard: isScores, signal });
}

export function setScore(body: {
  criterion_id: string;
  user_id: string;
  period: string;
  score: number;
  reason: string;
}): Promise<void> {
  return apiRequest("PUT", `${BASE}/scores`, { body });
}
