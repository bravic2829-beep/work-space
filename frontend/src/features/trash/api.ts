import { API, apiRequest } from "@/lib/api/client";

import { isFileTrashPage, isRestoredRecord, isTrashPage, type FileTrashPage, type TrashPage } from "./schema";

export function listTrash(cursor: string | null, signal?: AbortSignal): Promise<TrashPage> {
  const params = new URLSearchParams({ limit: "50" });
  if (cursor) params.set("cursor", cursor);
  return apiRequest("GET", `${API}/trash/records?${params.toString()}`, {
    guard: isTrashPage,
    signal,
  });
}

/** Remove a record in the trash for good. There is no undo. */
export function deleteForever(id: string): Promise<void> {
  return apiRequest("DELETE", `${API}/trash/records/${id}`);
}

export async function restoreRecord(id: string): Promise<void> {
  await apiRequest("POST", `${API}/records/${id}/restore`, {
    guard: isRestoredRecord,
  });
}

const FILE_TRASH = `${API}/trash/attachments`;

export function listFileTrash(cursor: string | null, signal?: AbortSignal): Promise<FileTrashPage> {
  const params = new URLSearchParams({ limit: "50" });
  if (cursor) params.set("cursor", cursor);
  return apiRequest("GET", `${FILE_TRASH}?${params}`, { guard: isFileTrashPage, signal });
}

export function restoreFile(id: string): Promise<void> {
  return apiRequest("POST", `${FILE_TRASH}/${id}/restore`);
}

export function deleteFileForever(id: string): Promise<void> {
  return apiRequest("DELETE", `${FILE_TRASH}/${id}`);
}

export function trashedFileDownloadUrl(id: string): string {
  return `${FILE_TRASH}/${id}/download`;
}
