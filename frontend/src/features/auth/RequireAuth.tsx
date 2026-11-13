"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "./AuthProvider";

/**
 * Sends anonymous visitors to the sign-in page. This is only a convenience for the user:
 * the backend decides what a request may do and answers 401/403 on its own.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (state.status === "anonymous") router.replace("/login");
  }, [state.status, router]);

  if (state.status === "authenticated") return <>{children}</>;
  if (state.status === "error") {
    return <p role="alert">Cannot reach the backend: {state.message}</p>;
  }
  return <p role="status">Loading…</p>;
}
