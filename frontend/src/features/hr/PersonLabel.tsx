"use client";

import { Avatar } from "@/components/ui";
import { labelParts, useUserNames } from "@/features/tables/useUserNames";

/**
 * An employee as a small avatar, the name and, quietly, the employee code. Without an id (nobody
 * is the head or the manager) it shows a dash.
 */
export function PersonLabel({ userId, showCode = false }: { userId: string | null; showCode?: boolean }) {
  const names = useUserNames(userId ? [userId] : []);
  if (!userId) return <span aria-label="nobody" className="text-line-strong">—</span>;
  const { name, code } = labelParts(names.get(userId) ?? "…");
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Avatar name={name} className="size-5 text-[10px]" />
      {name}
      {showCode && code && <span className="font-mono text-xs text-muted">{code}</span>}
    </span>
  );
}
