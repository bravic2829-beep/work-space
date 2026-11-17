import { apiRequest } from "@/lib/api/client";

import { isUser, type User } from "./schema";

export function login(
  employeeCode: string,
  password: string,
  rememberMe: boolean,
): Promise<User> {
  return apiRequest<User>("POST", "/api/v1/sessions", {
    body: { employee_code: employeeCode, password, remember_me: rememberMe },
    guard: isUser,
  });
}

export function logout(): Promise<void> {
  return apiRequest("DELETE", "/api/v1/sessions/current");
}

export function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  return apiRequest("PUT", "/api/v1/users/me/password", {
    body: { current_password: currentPassword, new_password: newPassword },
  });
}

export function fetchMe(signal?: AbortSignal): Promise<User> {
  return apiRequest<User>("GET", "/api/v1/users/me", { guard: isUser, signal });
}
