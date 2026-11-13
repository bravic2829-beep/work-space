import { isUser, type User, type UserLevel, type UserStatus } from "@/features/auth/schema";
import { apiRequest } from "@/lib/api/client";

import {
  isDepartment,
  isDepartmentList,
  isUserPage,
  type Department,
  type DepartmentKind,
  type UserPage,
} from "./schema";

export type UserFilters = { q: string; status: UserStatus | "" };

export function listUsers(
  filters: UserFilters,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<UserPage> {
  const params = new URLSearchParams({ limit: "50" });
  if (filters.q) params.set("q", filters.q);
  if (filters.status) params.set("status", filters.status);
  if (cursor) params.set("cursor", cursor);
  return apiRequest<UserPage>("GET", `/api/v1/users?${params.toString()}`, {
    guard: isUserPage,
    signal,
  });
}

export type NewUser = {
  employee_code: string;
  full_name: string;
  password: string;
  level: UserLevel;
  org_role: "admin" | "member";
  department_id: string | null;
};

export function createUser(payload: NewUser): Promise<User> {
  return apiRequest<User>("POST", "/api/v1/users", { body: payload, guard: isUser });
}

export type UserChanges = Partial<{
  full_name: string;
  level: UserLevel;
  org_role: "admin" | "member";
  status: UserStatus;
  department_id: string | null;
}>;

export function updateUser(id: string, changes: UserChanges): Promise<User> {
  return apiRequest<User>("PATCH", `/api/v1/users/${id}`, { body: changes, guard: isUser });
}

export function listDepartments(signal?: AbortSignal): Promise<Department[]> {
  return apiRequest<Department[]>("GET", "/api/v1/departments", {
    guard: isDepartmentList,
    signal,
  });
}

export function createDepartment(payload: {
  name: string;
  kind: DepartmentKind;
  parent_id: string | null;
}): Promise<Department> {
  return apiRequest<Department>("POST", "/api/v1/departments", {
    body: payload,
    guard: isDepartment,
  });
}

/** Sets (or clears, with null) the head of a department. */
export function setDepartmentHead(id: string, headUserId: string | null): Promise<Department> {
  return apiRequest<Department>("PATCH", `/api/v1/departments/${id}`, {
    body: { head_user_id: headUserId },
    guard: isDepartment,
  });
}

export function deleteDepartment(id: string): Promise<void> {
  return apiRequest("DELETE", `/api/v1/departments/${id}`);
}
