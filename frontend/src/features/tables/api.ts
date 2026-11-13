import { apiRequest } from "@/lib/api/client";

import {
  isBaseItem,
  isBaseList,
  isDirectoryList,
  isFieldItem,
  isRecordItem,
  isRecordPage,
  isTableDetail,
  isTableList,
  isViewItem,
  isViewList,
  isWorkspaceItem,
  isWorkspaceList,
  type BaseItem,
  type Condition,
  type DirectoryUser,
  type FieldItem,
  type FieldType,
  type RecordItem,
  type RecordPage,
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
};

export function createField(tableId: string, field: NewField): Promise<FieldItem> {
  return apiRequest("POST", `${API}/tables/${tableId}/fields`, {
    body: field,
    guard: isFieldItem,
  });
}

export function deleteField(id: string): Promise<void> {
  return apiRequest("DELETE", `${API}/fields/${id}`);
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
