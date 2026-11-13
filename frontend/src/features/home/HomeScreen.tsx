"use client";

import { ListChecks } from "lucide-react";
import Link from "next/link";

import { Card, PageHeader } from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { LEVEL_LABELS } from "@/features/auth/schema";
import { HealthStatus } from "@/features/health/HealthStatus";

export function HomeScreen() {
  const { state } = useAuth();
  if (state.status !== "authenticated") return null;
  const { user } = state;

  return (
    <>
      <PageHeader
        title="WorkBase"
        description={`Welcome, ${user.full_name}. Level: ${LEVEL_LABELS[user.level]}.`}
      />
      <div className="grid max-w-3xl gap-4">
        <Card>
          <h2 className="mt-0">Your work</h2>
          <p className="text-sm text-muted">
            Tasks given to you, from every table, are gathered in one list.
          </p>
          <Link href="/my-tasks" className="inline-flex items-center gap-1.5 text-sm font-medium">
            <ListChecks className="size-4" aria-hidden />
            Open my tasks
          </Link>
        </Card>
        <Card>
          <h2 className="mt-0">System status</h2>
          <HealthStatus />
        </Card>
      </div>
    </>
  );
}
