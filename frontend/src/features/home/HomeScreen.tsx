"use client";

import { useAuth } from "@/features/auth/AuthProvider";
import { LEVEL_LABELS } from "@/features/auth/schema";
import { HealthStatus } from "@/features/health/HealthStatus";

export function HomeScreen() {
  const { state } = useAuth();
  if (state.status !== "authenticated") return null;
  const { user } = state;

  return (
    <>
      <h1>WorkBase</h1>
      <p>
        Welcome, {user.full_name}. Level: {LEVEL_LABELS[user.level]}.
      </p>
      <p>Task management comes in the next phases. System status:</p>
      <HealthStatus />
    </>
  );
}
