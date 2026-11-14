import { Loader2, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/cn";

/** "Loading…" with a spinner. Announced to screen readers as a status. */
export function LoadingState({
  children = "Loading…",
  className,
}: {
  children?: string;
  className?: string;
}) {
  return (
    <p role="status" className={cn("flex items-center gap-2 text-sm text-muted", className)}>
      <Loader2 className="size-4 animate-spin" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/** What to show when a list has nothing in it. */
export function EmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong px-6 py-10 text-center">
      {Icon && <Icon className="size-8 text-muted" aria-hidden />}
      <p className="m-0 font-medium">{title}</p>
      {children && <p className="m-0 text-sm text-muted">{children}</p>}
    </div>
  );
}
