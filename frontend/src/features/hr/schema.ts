import { isUser, type User } from "@/features/auth/schema";

export type DepartmentKind = "division" | "department";

export type Department = {
  id: string;
  name: string;
  kind: DepartmentKind;
  parent_id: string | null;
};

export type UserPage = { items: User[]; next_cursor: string | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isDepartment(value: unknown): value is Department {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    (value.kind === "division" || value.kind === "department") &&
    (value.parent_id === null || typeof value.parent_id === "string")
  );
}

export function isDepartmentList(value: unknown): value is Department[] {
  return Array.isArray(value) && value.every(isDepartment);
}

export function isUserPage(value: unknown): value is UserPage {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every(isUser) &&
    (value.next_cursor === null || typeof value.next_cursor === "string")
  );
}
