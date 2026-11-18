import { isArrayOf, isRecord, pageOf } from "@/lib/api/guards";

/** Shapes of what the tables API returns, with guards (data from the network is never trusted). */

export type Role = "viewer" | "commenter" | "editor" | "admin";

export const FIELD_TYPES = [
  "text",
  "long_text",
  "number",
  "date",
  "checkbox",
  "single_select",
  "multi_select",
  "status",
  "user",
  "url",
  "link_record",
  "created_by",
  "created_time",
  "auto_number",
  "attachment",
  "timer",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** One column rule of a person: what they get of that column, narrower than their role. */
export type ColumnRule = { field_id: string; access: FieldAccess };

/** What one person is restricted to on a table (columns not listed follow their role). */
export type PersonAccess = { user_id: string; rules: ColumnRule[] };

function isAccess(value: unknown): value is FieldAccess {
  return value === "hidden" || value === "read" || value === "edit";
}

export function isPersonAccess(value: unknown): value is PersonAccess {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PersonAccess).user_id === "string" &&
    Array.isArray((value as PersonAccess).rules) &&
    (value as PersonAccess).rules.every(
      (rule) => typeof rule?.field_id === "string" && isAccess(rule.access),
    )
  );
}

export function isPersonAccessList(value: unknown): value is PersonAccess[] {
  return Array.isArray(value) && value.every(isPersonAccess);
}

/** A file kept in a column of type "attachment" (the bytes stay on the server). */
export type AttachmentItem = { id: string; name: string; size: number; content_type: string };

export function isAttachmentItem(value: unknown): value is AttachmentItem {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as AttachmentItem).id === "string" &&
    typeof (value as AttachmentItem).name === "string" &&
    typeof (value as AttachmentItem).size === "number" &&
    typeof (value as AttachmentItem).content_type === "string"
  );
}

/** The files of a cell: the server always sends a list, and a bad entry is simply left out. */
export function filesOf(value: unknown): AttachmentItem[] {
  return Array.isArray(value) ? value.filter(isAttachmentItem) : [];
}

export type FieldAccess = "hidden" | "read" | "edit";

export type SelectOption = { id: string; name: string; color?: string; kind?: string };

export type FieldItem = {
  id: string;
  table_id: string;
  name: string;
  type: FieldType;
  config: Record<string, unknown>;
  semantic: string | null;
  grants_view: boolean;
  is_required: boolean;
  position: number;
  access: FieldAccess;
};

export type WorkspaceItem = {
  id: string;
  name: string;
  kind: "shared" | "personal";
  owner_user_id: string | null;
  my_role: Role;
};

export type MemberItem = {
  user_id: string;
  employee_code: string;
  full_name: string;
  role: Role;
};

export type BaseItem = { id: string; workspace_id: string; name: string };
export type TableSummary = { id: string; base_id: string; name: string };
export type TableDetail = TableSummary & { fields: FieldItem[]; my_role: Role | null };

export type RecordItem = {
  id: string;
  table_id: string;
  data: Record<string, unknown>;
  created_by: string;
  created_at: string;
  updated_at: string;
  version: number;
};
export type RecordPage = { items: RecordItem[]; next_cursor: string | null };

export type CommentItem = {
  id: string;
  record_id: string;
  author: { id: string; full_name: string };
  body: string;
  created_at: string;
};
export type CommentPage = { items: CommentItem[]; next_cursor: string | null };

export type Condition = { field: string; op: string; value?: unknown };
export type SortColumn = { field: string; direction: "asc" | "desc" };
export type TotalFn = "sum" | "avg" | "min" | "max";
export type GroupBucket = "day" | "week" | "month";
export type ViewTotal = { field: string; fn: TotalFn };
export type ViewConfig = {
  filter: Condition[];
  sort: SortColumn[];
  hidden_fields: string[];
  /** Fold the rows into groups of this column (absent: no grouping). */
  group_by?: string;
  /** For a date column: group by day, week or month (month when absent). */
  group_bucket?: GroupBucket;
  /** Totals shown on each group. */
  totals?: ViewTotal[];
};
export type ViewItem = { id: string; table_id: string; name: string; config: ViewConfig };

export type DirectoryUser = { id: string; employee_code: string; full_name: string };

function isRole(value: unknown): value is Role {
  return value === "viewer" || value === "commenter" || value === "editor" || value === "admin";
}

export function isFieldItem(value: unknown): value is FieldItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.table_id === "string" &&
    typeof value.name === "string" &&
    FIELD_TYPES.includes(value.type as FieldType) &&
    isRecord(value.config) &&
    (value.semantic === null || typeof value.semantic === "string") &&
    typeof value.grants_view === "boolean" &&
    typeof value.is_required === "boolean" &&
    typeof value.position === "number" &&
    (value.access === "hidden" || value.access === "read" || value.access === "edit")
  );
}

export function isWorkspaceItem(value: unknown): value is WorkspaceItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    (value.kind === "shared" || value.kind === "personal") &&
    (value.owner_user_id === null || typeof value.owner_user_id === "string") &&
    isRole(value.my_role)
  );
}
export const isWorkspaceList = isArrayOf(isWorkspaceItem);

export function isMemberItem(value: unknown): value is MemberItem {
  return (
    isRecord(value) &&
    typeof value.user_id === "string" &&
    typeof value.employee_code === "string" &&
    typeof value.full_name === "string" &&
    isRole(value.role)
  );
}
export const isMemberList = isArrayOf(isMemberItem);

export function isBaseItem(value: unknown): value is BaseItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.workspace_id === "string" &&
    typeof value.name === "string"
  );
}
export const isBaseList = isArrayOf(isBaseItem);

export function isTableSummary(value: unknown): value is TableSummary {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.base_id === "string" &&
    typeof value.name === "string"
  );
}
export const isTableList = isArrayOf(isTableSummary);

export function isTableDetail(value: unknown): value is TableDetail {
  return (
    isTableSummary(value) &&
    isArrayOf(isFieldItem)((value as Record<string, unknown>).fields) &&
    ((value as Record<string, unknown>).my_role === null ||
      isRole((value as Record<string, unknown>).my_role))
  );
}

export const isFieldList = isArrayOf(isFieldItem);

export function isRecordItem(value: unknown): value is RecordItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.table_id === "string" &&
    isRecord(value.data) &&
    typeof value.created_by === "string" &&
    typeof value.created_at === "string" &&
    typeof value.updated_at === "string" &&
    typeof value.version === "number"
  );
}

export const isRecordPage = pageOf(isRecordItem);

function isCondition(value: unknown): value is Condition {
  return isRecord(value) && typeof value.field === "string" && typeof value.op === "string";
}

function isSortColumn(value: unknown): value is SortColumn {
  return (
    isRecord(value) &&
    typeof value.field === "string" &&
    (value.direction === "asc" || value.direction === "desc")
  );
}

const TOTAL_FNS: readonly unknown[] = ["sum", "avg", "min", "max"];
const BUCKETS: readonly unknown[] = ["day", "week", "month"];

function isViewTotal(value: unknown): value is ViewTotal {
  return isRecord(value) && typeof value.field === "string" && TOTAL_FNS.includes(value.fn);
}

export function isViewItem(value: unknown): value is ViewItem {
  if (!isRecord(value) || !isRecord(value.config)) return false;
  const config = value.config;
  return (
    typeof value.id === "string" &&
    typeof value.table_id === "string" &&
    typeof value.name === "string" &&
    isArrayOf(isCondition)(config.filter) &&
    isArrayOf(isSortColumn)(config.sort) &&
    isArrayOf((v): v is string => typeof v === "string")(config.hidden_fields) &&
    // The grouping keys are absent from a view that does not group.
    (config.group_by === undefined || typeof config.group_by === "string") &&
    (config.group_bucket === undefined || BUCKETS.includes(config.group_bucket)) &&
    (config.totals === undefined || isArrayOf(isViewTotal)(config.totals))
  );
}
export const isViewList = isArrayOf(isViewItem);

/** One group of records: how many, the totals, and the filter that selects its records. */
export type Group = {
  /** An option id, a person's id, a record id, a date bucket, a text; null: no value. */
  key: string | null;
  label: string;
  count: number;
  totals: { field_id: string; fn: TotalFn; value: number | null }[];
  /** Null: the group cannot be opened (its value no longer exists). */
  filter: Condition[] | null;
};

export type GroupsResult = {
  group_by: string;
  bucket: GroupBucket | null;
  /** How many records match the filter, before they are folded into groups. */
  total: number;
  /** More groups than the server sends: the rest are left out. */
  truncated: boolean;
  groups: Group[];
};

function isGroup(value: unknown): value is Group {
  return (
    isRecord(value) &&
    (value.key === null || typeof value.key === "string") &&
    typeof value.label === "string" &&
    typeof value.count === "number" &&
    isArrayOf(
      (t): t is Group["totals"][number] =>
        isRecord(t) &&
        typeof t.field_id === "string" &&
        TOTAL_FNS.includes(t.fn) &&
        (t.value === null || typeof t.value === "number"),
    )(value.totals) &&
    (value.filter === null || isArrayOf(isCondition)(value.filter))
  );
}

export function isGroupsResult(value: unknown): value is GroupsResult {
  return (
    isRecord(value) &&
    typeof value.group_by === "string" &&
    (value.bucket === null || BUCKETS.includes(value.bucket)) &&
    typeof value.total === "number" &&
    typeof value.truncated === "boolean" &&
    isArrayOf(isGroup)(value.groups)
  );
}

export function isDirectoryUser(value: unknown): value is DirectoryUser {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.employee_code === "string" &&
    typeof value.full_name === "string"
  );
}
export const isDirectoryList = isArrayOf(isDirectoryUser);

export function isCommentItem(value: unknown): value is CommentItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.record_id === "string" &&
    isRecord(value.author) &&
    typeof value.author.id === "string" &&
    typeof value.author.full_name === "string" &&
    typeof value.body === "string" &&
    typeof value.created_at === "string"
  );
}

export type ViewerReason = "creator" | "assignee" | "follower" | "field" | "sheet";
export type RecordViewer = {
  user_id: string;
  full_name: string;
  employee_code: string;
  reasons: ViewerReason[];
  field_names: string[];
};
/** Who can see one record: the people named on it, and how many people the workspace has. */
export type RecordViewers = {
  people: RecordViewer[];
  workspace_name: string;
  workspace_member_count: number;
};

const REASONS = ["creator", "assignee", "follower", "field", "sheet"];

function isRecordViewer(value: unknown): value is RecordViewer {
  return (
    isRecord(value) &&
    typeof value.user_id === "string" &&
    typeof value.full_name === "string" &&
    typeof value.employee_code === "string" &&
    Array.isArray(value.reasons) &&
    value.reasons.every((reason) => typeof reason === "string" && REASONS.includes(reason)) &&
    Array.isArray(value.field_names) &&
    value.field_names.every((name) => typeof name === "string")
  );
}

export function isRecordViewers(value: unknown): value is RecordViewers {
  return (
    isRecord(value) &&
    Array.isArray(value.people) &&
    value.people.every(isRecordViewer) &&
    typeof value.workspace_name === "string" &&
    typeof value.workspace_member_count === "number"
  );
}

export const isCommentPage = pageOf(isCommentItem);
