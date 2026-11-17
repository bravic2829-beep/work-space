import type { LucideIcon } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/cn";

export type StatTone = "neutral" | "danger" | "warning" | "success" | "info";

const TONES: Record<StatTone, string> = {
  danger: "bg-danger-soft text-danger",
  warning: "bg-warning-soft text-warning",
  success: "bg-success-soft text-success",
  info: "bg-primary-soft text-primary",
  neutral: "bg-surface-muted text-muted",
};

const FRAME = "flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3";

/**
 * One number with its label and an icon, as an item of a list. `value` null means the number is
 * not available to this person: it shows a dash, and `unavailableHint` says why on hover.
 * With `href` the card is a link (to what was counted); a number that is not available is never
 * a link.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "neutral",
  unavailableHint,
  href,
}: {
  label: string;
  value: number | string | null;
  icon: LucideIcon;
  tone?: StatTone;
  unavailableHint?: string;
  href?: string;
}) {
  const unavailable = value === null;
  const body = (
    <>
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-md", TONES[tone])}>
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-xl font-bold tabular-nums">{unavailable ? "—" : value}</span>
        <span className="text-[13px] text-muted">{label}</span>
      </span>
    </>
  );
  if (href && !unavailable) {
    return (
      <li>
        <Link
          href={href}
          aria-label={`${label}: ${value}. Show these tasks`}
          className={cn(
            FRAME,
            "text-fg no-underline transition-colors hover:border-primary hover:bg-surface-muted",
          )}
        >
          {body}
        </Link>
      </li>
    );
  }
  return (
    <li className={FRAME} title={unavailable ? unavailableHint : undefined}>
      {body}
    </li>
  );
}
