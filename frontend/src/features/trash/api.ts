import { apiRequest } from "@/lib/api/client";

import { isRestoredRecord, isTrashPage, type TrashPage } from "./schema";

const API = "/api/v1";

export function listTrash(cursor: string | null, signal?: AbortSignal): Promise<TrashPage> {
  const params = new URLSearchParams({ limit: "50" });
  if (cursor) params.set("cursor", cursor);
  return apiRequest("GET", `${API}/trash/records?${params.toString()}`, {
    guard: isTrashPage,
    signal,
  });
}

export async function restoreRecord(id: string): Promise<void> {
  await apiRequest("POST", `${API}/records/${id}/restore`, {
    guard: isRestoredRecord,
  });
}
