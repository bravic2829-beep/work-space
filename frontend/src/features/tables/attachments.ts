import { apiRequest } from "@/lib/api/client";

import { isRecordItem, type RecordItem } from "./schema";

/** The biggest file the server takes (it says no above this; this only saves the wait). */
export const MAX_FILE_BYTES = 10_000_000;

/** The kinds of file the server takes (the same list; anything that could run is not on it). */
export const FILE_EXTENSIONS = [
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "xlsm",
  "csv",
  "ppt",
  "pptx",
  "txt",
  "md",
  "rtf",
  "odt",
  "ods",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "zip",
  "7z",
  "rar",
] as const;

export const FILE_ACCEPT = FILE_EXTENSIONS.map((e) => `.${e}`).join(",");

/** Where a file is downloaded from. It is a plain link: the browser saves the file, and the
 * server checks the person's right to see the column first. */
export function attachmentUrl(id: string): string {
  return `/api/v1/attachments/${id}`;
}

/** Add a file to a files column of a task. Returns the task with its new list of files. */
export function uploadAttachment(
  recordId: string,
  fieldId: string,
  file: File,
  signal?: AbortSignal,
): Promise<RecordItem> {
  const query = new URLSearchParams({ field_id: fieldId });
  return apiRequest("POST", `/api/v1/records/${recordId}/attachments?${query.toString()}`, {
    rawBody: file,
    headers: {
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name),
    },
    guard: isRecordItem,
    signal,
  });
}

/** Take a file out of its task. Returns the task with its new list of files. */
export function deleteAttachment(id: string): Promise<RecordItem> {
  return apiRequest("DELETE", `/api/v1/attachments/${id}`, { guard: isRecordItem });
}

/** "2.1 MB", "340 KB", "12 B". */
export function formatSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** Why a file should not even be sent, or null when it looks fine. */
export function checkFile(file: File): string | null {
  const dot = file.name.lastIndexOf(".");
  const extension = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  if (!(FILE_EXTENSIONS as readonly string[]).includes(extension)) {
    return `“${file.name}” is not a kind of file we accept. Allowed: ${FILE_EXTENSIONS.join(", ")}.`;
  }
  if (file.size === 0) return `“${file.name}” is empty.`;
  if (file.size > MAX_FILE_BYTES) {
    return `“${file.name}” is too big (${formatSize(file.size)}). The limit is ${MAX_FILE_BYTES / 1_000_000} MB.`;
  }
  return null;
}
