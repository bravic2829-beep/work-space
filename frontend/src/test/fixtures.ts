import type { User } from "@/features/auth/schema";

export function sampleUser(overrides: Partial<User> = {}): User {
  return {
    id: "u-1",
    employee_code: "E001",
    full_name: "Nguyen Van A",
    org_role: "member",
    level: "employee",
    status: "active",
    department_id: null,
    manager_id: null,
    ...overrides,
  };
}

export const adminUser = sampleUser({
  id: "admin-1",
  employee_code: "ADMIN",
  full_name: "Admin User",
  org_role: "admin",
  level: "admin",
});
