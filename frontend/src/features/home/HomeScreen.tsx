"use client";

import { FolderKanban, ListChecks, Trash2, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { Card, PageHeader } from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { LEVEL_LABELS } from "@/features/auth/schema";
import { HealthStatus } from "@/features/health/HealthStatus";

const SHORTCUTS: { href: string; title: string; text: string; icon: LucideIcon }[] = [
  {
    href: "/my-tasks",
    title: "My tasks",
    text: "Tasks given to you, from every table, in one list.",
    icon: ListChecks,
  },
  {
    href: "/workspaces",
    title: "Workspaces",
    text: "Your bases and tables, and who works in them.",
    icon: FolderKanban,
  },
  {
    href: "/trash",
    title: "Trash",
    text: "Records you deleted. You can restore them for 30 days.",
    icon: Trash2,
  },
];

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
      <div className="grid gap-5">
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3 p-0">
          {SHORTCUTS.map(({ href, title, text, icon: Icon }) => (
            <li
              key={href}
              className="relative flex items-start gap-3 rounded-lg border border-line bg-surface p-4 transition-colors hover:border-primary hover:bg-primary-soft/40"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded bg-primary-soft text-primary">
                <Icon className="size-4.5" aria-hidden />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <Link
                  href={href}
                  className="font-semibold text-fg no-underline after:absolute after:inset-0 hover:no-underline"
                >
                  {title}
                </Link>
                <span className="text-sm text-muted">{text}</span>
              </span>
            </li>
          ))}
        </ul>
        <Card className="max-w-md">
          <h2 className="mt-0 text-base">System status</h2>
          <HealthStatus />
        </Card>
      </div>
    </>
  );
}
