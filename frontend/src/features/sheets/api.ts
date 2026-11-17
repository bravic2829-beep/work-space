import { API, apiRequest } from "@/lib/api/client";
import {
  recordQueryString,
  type RecordQuery,
} from "@/features/tables/api";
import {
  isRecordItem,
  isRecordPage,
  type RecordItem,
  type RecordPage,
} from "@/features/tables/schema";

import {
  isMemberList,
  isSheetItem,
  isSheetList,
  isSheetMember,
  type SheetItem,
  type SheetMemberItem,
  type SheetRole,
} from "./schema";

/** The sheets the caller may open (an admin gets every sheet). */
export function listSheets(signal?: AbortSignal): Promise<SheetItem[]> {
  return apiRequest("GET", `${API}/sheets`, { guard: isSheetList, signal });
}

export type NewSheet = {
  owner_id: string;
  name?: string;
  members?: { user_id: string; role: SheetRole }[];
};

export function createSheet(tableId: string, body: NewSheet): Promise<SheetItem> {
  return apiRequest("POST", `${API}/tables/${tableId}/sheets`, { body, guard: isSheetItem });
}

export function renameSheet(id: string, name: string): Promise<SheetItem> {
  return apiRequest("PATCH", `${API}/sheets/${id}`, { body: { name }, guard: isSheetItem });
}

export function archiveSheet(id: string): Promise<void> {
  return apiRequest("DELETE", `${API}/sheets/${id}`);
}

export function listSheetMembers(id: string, signal?: AbortSignal): Promise<SheetMemberItem[]> {
  return apiRequest("GET", `${API}/sheets/${id}/members`, { guard: isMemberList, signal });
}

export function setSheetMember(
  id: string,
  userId: string,
  role: SheetRole,
): Promise<SheetMemberItem> {
  return apiRequest("PUT", `${API}/sheets/${id}/members/${userId}`, {
    body: { role },
    guard: isSheetMember,
  });
}

export function removeSheetMember(id: string, userId: string): Promise<void> {
  return apiRequest("DELETE", `${API}/sheets/${id}/members/${userId}`);
}

/** The tasks of one sheet: the table's records that name its owner as assignee. */
export function listSheetRecords(
  id: string,
  query: RecordQuery,
  signal?: AbortSignal,
): Promise<RecordPage> {
  return apiRequest("GET", `${API}/sheets/${id}/records?${recordQueryString(query)}`, {
    guard: isRecordPage,
    signal,
  });
}

/** Adds a task to the sheet; its owner becomes the assignee. */
export function createSheetRecord(id: string, data: Record<string, unknown>): Promise<RecordItem> {
  return apiRequest("POST", `${API}/sheets/${id}/records`, { body: { data }, guard: isRecordItem });
}
