import { isUser, type User } from "@/features/auth/schema";
import { isRecord, pageOf } from "@/lib/api/guards";

export type DepartmentKind = "division" | "department";

export type Department = {
  id: string;
  name: string;
  kind: DepartmentKind;
  parent_id: string | null;
  head_user_id: string | null;
};

export type UserPage = { items: User[]; next_cursor: string | null };

export function isDepartment(value: unknown): value is Department {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    (value.kind === "division" || value.kind === "department") &&
    (value.parent_id === null || typeof value.parent_id === "string") &&
    (value.head_user_id === null || typeof value.head_user_id === "string")
  );
}

export function isDepartmentList(value: unknown): value is Department[] {
  return Array.isArray(value) && value.every(isDepartment);
}

export const isUserPage = pageOf(isUser);
