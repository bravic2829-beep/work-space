import { apiRequest } from "@/lib/api/client";

import { isMyTaskPage, localToday, type MyTaskPage } from "./schema";

export type Scope = "assigned" | "today";

export function listMyTasks(
  scope: Scope,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<MyTaskPage> {
  const params = new URLSearchParams({ scope, limit: "50" });
  if (scope === "today") params.set("date", localToday());
  if (cursor) params.set("cursor", cursor);
  return apiRequest("GET", `/api/v1/me/tasks?${params.toString()}`, {
    guard: isMyTaskPage,
    signal,
  });
}
