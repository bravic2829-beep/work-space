"use client";

import { useAuth } from "./AuthProvider";
import { isOrgAdmin } from "./schema";

/** Hides admin-only screens from other users. Only a UX guard: the backend enforces it (403). */
export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  if (state.status !== "authenticated") return null;
  if (!isOrgAdmin(state.user)) {
    return <p role="alert">You do not have access to this page.</p>;
  }
  return <>{children}</>;
}
