import { Badge, type Tone } from "@/components/ui";
import { cn } from "@/lib/cn";

import { percent, STATUS_LABELS, type KrStatus } from "./schema";

const STATUS_TONE: Record<KrStatus, Tone> = {
  on_track: "success",
  at_risk: "warning",
  off_track: "danger",
};

/** How a key result is going, as the owner said it at the last check-in. */
export function StatusPill({ status }: { status: KrStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} className="gap-1.5">
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {STATUS_LABELS[status]}
    </Badge>
  );
}

/** A bar and the percentage. `value` is 0 to 1; null (no key results yet) shows a dash. */
export function ProgressBar({ value, label }: { value: number | null; label: string }) {
  const done = value !== null && value >= 1;
  return (
    <div className="flex min-w-32 items-center gap-2">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value === null ? undefined : Math.round(value * 100)}
        className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted"
      >
        {value !== null && (
          <div
            className={cn("h-full rounded-full", done ? "bg-success" : "bg-primary")}
            style={{ width: `${Math.round(value * 100)}%` }}
          />
        )}
      </div>
      <span className="w-10 text-right text-xs font-semibold tabular-nums">{percent(value)}</span>
    </div>
  );
}
