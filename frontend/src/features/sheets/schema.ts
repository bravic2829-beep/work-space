export type SheetRole = "viewer" | "commenter" | "editor" | "manager";

export const SHEET_ROLES: SheetRole[] = ["viewer", "commenter", "editor", "manager"];

export const SHEET_ROLE_LABELS: Record<SheetRole, string> = {
  viewer: "Can view",
  commenter: "Can comment",
  editor: "Can edit",
  manager: "Can manage",
};

export type SheetOwner = { id: string; full_name: string; employee_code: string };

export type SheetItem = {
  id: string;
  table_id: string;
  table_name: string;
  owner: SheetOwner;
  name: string;
  /** What the caller may do on this sheet (admins are managers). */
  my_role: SheetRole;
  /** Admins may also rename and archive the sheet. */
  is_admin: boolean;
  /** The caller sees every task of the table, not only this sheet's. */
  can_see_all: boolean;
  member_count: number;
};

export type SheetMemberItem = {
  user_id: string;
  full_name: string;
  employee_code: string;
  role: SheetRole;
  is_owner: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isSheetRole(value: unknown): value is SheetRole {
  return typeof value === "string" && (SHEET_ROLES as string[]).includes(value);
}

function isOwner(value: unknown): value is SheetOwner {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.full_name === "string" &&
    typeof value.employee_code === "string"
  );
}

export function isSheetItem(value: unknown): value is SheetItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.table_id === "string" &&
    typeof value.table_name === "string" &&
    isOwner(value.owner) &&
    typeof value.name === "string" &&
    isSheetRole(value.my_role) &&
    typeof value.is_admin === "boolean" &&
    typeof value.can_see_all === "boolean" &&
    typeof value.member_count === "number"
  );
}

export function isSheetList(value: unknown): value is SheetItem[] {
  return Array.isArray(value) && value.every(isSheetItem);
}

export function isSheetMember(value: unknown): value is SheetMemberItem {
  return (
    isRecord(value) &&
    typeof value.user_id === "string" &&
    typeof value.full_name === "string" &&
    typeof value.employee_code === "string" &&
    isSheetRole(value.role) &&
    typeof value.is_owner === "boolean"
  );
}

export function isMemberList(value: unknown): value is SheetMemberItem[] {
  return Array.isArray(value) && value.every(isSheetMember);
}

/**
 * The access a person has to a column while looking at a sheet: managers edit all, editors all but
 * the columns that belong to the manager. The backend decides for real; this only shows the right
 * controls (same rule as the backend's sheet access).
 */
const LOCKED_FOR_EDITORS = new Set([
  "assignee",
  "follower",
  "status",
  "feedback",
  "timer_start",
  "timer_stop",
]);

export function sheetAccess(
  role: SheetRole,
  field: { access: "hidden" | "read" | "edit"; semantic: string | null },
): "hidden" | "read" | "edit" {
  if (field.access === "hidden") return "hidden";
  if (role === "manager") return "edit";
  if (role === "editor" && !(field.semantic !== null && LOCKED_FOR_EDITORS.has(field.semantic))) {
    return "edit";
  }
  return "read";
}
