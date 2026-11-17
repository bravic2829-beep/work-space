export type OrgRole = "owner" | "admin" | "member";
export type UserLevel = "admin" | "division_manager" | "department_manager" | "employee";
export type UserStatus = "active" | "disabled";

export type User = {
  id: string;
  employee_code: string;
  full_name: string;
  org_role: OrgRole;
  level: UserLevel;
  status: UserStatus;
  department_id: string | null;
  manager_id: string | null;
  /** An admin set a temporary password: it must be replaced before anything else is open. */
  must_change_password: boolean;
};

const ORG_ROLES: readonly string[] = ["owner", "admin", "member"];
const LEVELS: readonly string[] = ["admin", "division_manager", "department_manager", "employee"];
const STATUSES: readonly string[] = ["active", "disabled"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function isUser(value: unknown): value is User {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.employee_code === "string" &&
    typeof value.full_name === "string" &&
    typeof value.org_role === "string" &&
    ORG_ROLES.includes(value.org_role) &&
    typeof value.level === "string" &&
    LEVELS.includes(value.level) &&
    typeof value.status === "string" &&
    STATUSES.includes(value.status) &&
    isStringOrNull(value.department_id) &&
    isStringOrNull(value.manager_id) &&
    typeof value.must_change_password === "boolean"
  );
}

/** Organization owners and admins manage the HR module. This only drives the UI: the backend
 * checks the permission again on every request. */
export function isOrgAdmin(user: User): boolean {
  return user.org_role === "owner" || user.org_role === "admin";
}

export const LEVEL_LABELS: Record<UserLevel, string> = {
  admin: "Admin",
  division_manager: "Division manager",
  department_manager: "Department manager",
  employee: "Employee",
};
