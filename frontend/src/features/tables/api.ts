import { API, apiRequest, ifMatch } from "@/lib/api/client";

import {
  isBaseItem,
  isBaseList,
  isCommentItem,
  isCommentPage,
  isDirectoryList,
  isFieldItem,
  isGroupsResult,
  isPersonAccess,
  isPersonAccessList,
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
  type FieldAccess,
  type FieldItem,
  type FieldType,
  type GroupBucket,
  type GroupsResult,
  type MemberItem,
  type PersonAccess,
  type RecordItem,
  type RecordPage,
  type RecordViewers,
  type Role,
  type SortColumn,
  type TableDetail,
  type TableSummary,
  type ViewConfig,
  type ViewTotal,
  type ViewItem,
  type WorkspaceItem,
} from "./schema";

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
  /** The role of the column (assignee, status, due_date...). */
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

// --- who sees which column ---

/** Everybody who has a column rule on the table (for workspace admins). */
export function getTableAccess(tableId: string, signal?: AbortSignal): Promise<PersonAccess[]> {
  return apiRequest("GET", `${API}/tables/${tableId}/field-access`, {
    guard: isPersonAccessList,
    signal,
  });
}

/**
 * Sets what one person sees of several columns at once: hidden, read, edit, or null to go back to
 * the default. Columns that are not named stay as they are. All or nothing.
 */
export function setPersonAccess(
  tableId: string,
  userId: string,
  fields: Record<string, FieldAccess | null>,
): Promise<PersonAccess> {
  return apiRequest("PUT", `${API}/tables/${tableId}/field-access/${userId}`, {
    body: { fields },
    guard: isPersonAccess,
  });
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

export type GroupsQuery = {
  groupBy: string;
  bucket?: GroupBucket | null;
  totals: ViewTotal[];
  filter: Condition[];
};

/** The records folded into groups of one column, with their counts and totals. */
export function getGroups(
  tableId: string,
  query: GroupsQuery,
  signal?: AbortSignal,
): Promise<GroupsResult> {
  const params = new URLSearchParams({ group_by: query.groupBy });
  if (query.bucket) params.set("bucket", query.bucket);
  for (const total of query.totals) params.append("aggregate", `${total.field}:${total.fn}`);
  if (query.filter.length > 0) params.set("filter", JSON.stringify(query.filter));
  return apiRequest("GET", `${API}/tables/${tableId}/groups?${params.toString()}`, {
    guard: isGroupsResult,
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
    headers: ifMatch(version),
  });
}

export function deleteRecord(id: string): Promise<void> {
  return apiRequest("DELETE", `${API}/records/${id}`);
}

export type ReviewAction = "submit" | "approve" | "reject" | "pause" | "block" | "resume";

/** Report a task as done (submit), approve it or send it back (the version is sent as If-Match). */
export function reviewRecord(
  id: string,
  version: number,
  action: ReviewAction,
  /** Required to send back (reject) and to report a blocker (block): the why. */
  reason?: string,
): Promise<RecordItem> {
  return apiRequest("POST", `${API}/records/${id}/review`, {
    body: reason === undefined ? { action } : { action, reason },
    guard: isRecordItem,
    headers: ifMatch(version),
  });
}

export type TimerAction = "start" | "stop";

/**
 * Start the task timer (who gave the task) or stop it (the assignee). Sends If-Match. A table with
 * several timer columns needs `fieldId` to say which one.
 */
export function timerRecord(
  id: string,
  version: number,
  action: TimerAction,
  fieldId?: string,
): Promise<RecordItem> {
  return apiRequest("POST", `${API}/records/${id}/timer`, {
    body: fieldId === undefined ? { action } : { action, field_id: fieldId },
    guard: isRecordItem,
    headers: ifMatch(version),
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
