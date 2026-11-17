import { apiRequest } from "@/lib/api/client";

import {
  isBaseItem,
  isBaseList,
  isCommentItem,
  isCommentPage,
  isDirectoryList,
  isFieldItem,
  isMemberItem,
  isMemberList,
  isRecordItem,
  isRecordPage,
  isRecordViewers,
  isTableDetail,
  isTableList,
  isViewItem,
  isViewList,
  isWorkspaceItem,
  isWorkspaceList,
  type BaseItem,
  type CommentItem,
  type CommentPage,
  type Condition,
  type DirectoryUser,
  type FieldItem,
  type FieldType,
  type MemberItem,
  type RecordItem,
  type RecordPage,
  type RecordViewers,
  type Role,
  type SortColumn,
  type TableDetail,
  type TableSummary,
  type ViewConfig,
  type ViewItem,
  type WorkspaceItem,
} from "./schema";

const API = "/api/v1";

// --- workspaces, bases, tables ---

export function listWorkspaces(signal?: AbortSignal): Promise<WorkspaceItem[]> {
  return apiRequest("GET", `${API}/workspaces`, { guard: isWorkspaceList, signal });
}

export function createWorkspace(name: string): Promise<WorkspaceItem> {
  return apiRequest("POST", `${API}/workspaces`, { body: { name }, guard: isWorkspaceItem });
}

export function getWorkspace(id: string, signal?: AbortSignal): Promise<WorkspaceItem> {
  return apiRequest("GET", `${API}/workspaces/${id}`, { guard: isWorkspaceItem, signal });
}

export function listBases(workspaceId: string, signal?: AbortSignal): Promise<BaseItem[]> {
  return apiRequest("GET", `${API}/workspaces/${workspaceId}/bases`, {
    guard: isBaseList,
    signal,
  });
}

export function createBase(workspaceId: string, name: string): Promise<BaseItem> {
  return apiRequest("POST", `${API}/workspaces/${workspaceId}/bases`, {
    body: { name },
    guard: isBaseItem,
  });
}

export function listTables(baseId: string, signal?: AbortSignal): Promise<TableSummary[]> {
  return apiRequest("GET", `${API}/bases/${baseId}/tables`, { guard: isTableList, signal });
}

export function createTable(
  baseId: string,
  name: string,
  template: "blank" | "tasks",
): Promise<TableDetail> {
  return apiRequest("POST", `${API}/bases/${baseId}/tables`, {
    body: { name, template },
    guard: isTableDetail,
  });
}

export function getTable(id: string, signal?: AbortSignal): Promise<TableDetail> {
  return apiRequest("GET", `${API}/tables/${id}`, { guard: isTableDetail, signal });
}

// --- fields ---

export type NewField = {
  name: string;
  type: FieldType;
  config?: Record<string, unknown>;
  is_required?: boolean;
  /** The role of the column (the timer columns use timer_start and timer_stop). */
  semantic?: string | null;
};

export function createField(tableId: string, field: NewField): Promise<FieldItem> {
  return apiRequest("POST", `${API}/tables/${tableId}/fields`, {
    body: field,
    guard: isFieldItem,
  });
}

export type FieldPatch = {
  name?: string;
  type?: FieldType;
  config?: Record<string, unknown>;
  is_required?: boolean;
  /** A role (assignee, follower, status, due_date), or null to take the role away. */
  semantic?: string | null;
};

/** Renames a column, changes its options, makes it required, or converts its type. */
export function updateField(id: string, patch: FieldPatch): Promise<FieldItem> {
  return apiRequest("PATCH", `${API}/fields/${id}`, { body: patch, guard: isFieldItem });
}

export function deleteField(id: string): Promise<void> {
  return apiRequest("DELETE", `${API}/fields/${id}`);
}

// --- workspace members ---

export function listMembers(workspaceId: string, signal?: AbortSignal): Promise<MemberItem[]> {
  return apiRequest("GET", `${API}/workspaces/${workspaceId}/members`, {
    guard: isMemberList,
    signal,
  });
}

export function addMember(workspaceId: string, userId: string, role: Role): Promise<MemberItem> {
  return apiRequest("POST", `${API}/workspaces/${workspaceId}/members`, {
    body: { user_id: userId, role },
    guard: isMemberItem,
  });
}

export function changeMemberRole(
  workspaceId: string,
  userId: string,
  role: Role,
): Promise<MemberItem> {
  return apiRequest("PATCH", `${API}/workspaces/${workspaceId}/members/${userId}`, {
    body: { role },
    guard: isMemberItem,
  });
}

export function removeMember(workspaceId: string, userId: string): Promise<void> {
  return apiRequest("DELETE", `${API}/workspaces/${workspaceId}/members/${userId}`);
}

// --- records ---

export type RecordQuery = {
  filter: Condition[];
  sort: SortColumn[];
  cursor?: string | null;
  limit?: number;
};

/** The query string of a record list: sort=<field>:<dir> (repeated) and filter=<JSON>. */
export function recordQueryString(query: RecordQuery): string {
  const params = new URLSearchParams({ limit: String(query.limit ?? 50) });
  for (const column of query.sort) params.append("sort", `${column.field}:${column.direction}`);
  if (query.filter.length > 0) params.set("filter", JSON.stringify(query.filter));
  if (query.cursor) params.set("cursor", query.cursor);
  return params.toString();
}

export function listRecords(
  tableId: string,
  query: RecordQuery,
  signal?: AbortSignal,
): Promise<RecordPage> {
  return apiRequest("GET", `${API}/tables/${tableId}/records?${recordQueryString(query)}`, {
    guard: isRecordPage,
    signal,
  });
}

/** One record by id (to name a record that is already linked). */
export function getRecord(id: string, signal?: AbortSignal): Promise<RecordItem> {
  return apiRequest("GET", `${API}/records/${id}`, { guard: isRecordItem, signal });
}

export function createRecord(
  tableId: string,
  data: Record<string, unknown>,
): Promise<RecordItem> {
  return apiRequest("POST", `${API}/tables/${tableId}/records`, {
    body: { data },
    guard: isRecordItem,
  });
}

/** Changes some cells. `version` is the version the person was looking at (If-Match). */
export function updateRecord(
  id: string,
  version: number,
  data: Record<string, unknown>,
): Promise<RecordItem> {
  return apiRequest("PATCH", `${API}/records/${id}`, {
    body: { data },
    guard: isRecordItem,
    headers: { "If-Match": `"${version}"` },
  });
}

export function deleteRecord(id: string): Promise<void> {
  return apiRequest("DELETE", `${API}/records/${id}`);
}

export type ReviewAction = "submit" | "approve" | "reject";

/** Report a task as done (submit), approve it or send it back (the version is sent as If-Match). */
export function reviewRecord(
  id: string,
  version: number,
  action: ReviewAction,
  /** Required to send back (reject): what needs to change. */
  reason?: string,
): Promise<RecordItem> {
  return apiRequest("POST", `${API}/records/${id}/review`, {
    body: reason === undefined ? { action } : { action, reason },
    guard: isRecordItem,
    headers: { "If-Match": `"${version}"` },
  });
}

export type TimerAction = "start" | "stop";

/** Start the task timer (who gave the task) or stop it (the assignee). Sends If-Match. */
export function timerRecord(
  id: string,
  version: number,
  action: TimerAction,
): Promise<RecordItem> {
  return apiRequest("POST", `${API}/records/${id}/timer`, {
    body: { action },
    guard: isRecordItem,
    headers: { "If-Match": `"${version}"` },
  });
}

/** Who can see this record: the people named on it and the size of its workspace. */
export function getRecordViewers(id: string, signal?: AbortSignal): Promise<RecordViewers> {
  return apiRequest("GET", `${API}/records/${id}/viewers`, { guard: isRecordViewers, signal });
}

// --- comments ---

export function listComments(
  recordId: string,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<CommentPage> {
  const params = new URLSearchParams({ limit: "50" });
  if (cursor) params.set("cursor", cursor);
  return apiRequest("GET", `${API}/records/${recordId}/comments?${params.toString()}`, {
    guard: isCommentPage,
    signal,
  });
}

export function createComment(recordId: string, body: string): Promise<CommentItem> {
  return apiRequest("POST", `${API}/records/${recordId}/comments`, {
    body: { body },
    guard: isCommentItem,
  });
}

export function deleteComment(id: string): Promise<void> {
  return apiRequest("DELETE", `${API}/comments/${id}`);
}

// --- views ---

export function listViews(tableId: string, signal?: AbortSignal): Promise<ViewItem[]> {
  return apiRequest("GET", `${API}/tables/${tableId}/views`, { guard: isViewList, signal });
}

export function createView(tableId: string, name: string, config: ViewConfig): Promise<ViewItem> {
  return apiRequest("POST", `${API}/tables/${tableId}/views`, {
    body: { name, config },
    guard: isViewItem,
  });
}

export function deleteView(id: string): Promise<void> {
  return apiRequest("DELETE", `${API}/views/${id}`);
}

// --- colleagues ---

export function searchDirectory(q: string, signal?: AbortSignal): Promise<DirectoryUser[]> {
  const params = new URLSearchParams({ limit: "20" });
  if (q) params.set("q", q);
  return apiRequest("GET", `${API}/directory/users?${params.toString()}`, {
    guard: isDirectoryList,
    signal,
  });
}

export function lookupUsers(ids: string[], signal?: AbortSignal): Promise<DirectoryUser[]> {
  const params = new URLSearchParams();
  for (const id of ids) params.append("ids", id);
  return apiRequest("GET", `${API}/directory/users?${params.toString()}`, {
    guard: isDirectoryList,
    signal,
  });
}
