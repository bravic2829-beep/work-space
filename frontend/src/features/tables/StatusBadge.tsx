import { Badge, type Tone } from "@/components/ui";

import type { StatusKind } from "./taskWorkflow";

const TONE_OF_KIND: Record<StatusKind, Tone> = {
  todo: "neutral",
  in_progress: "info",
  review: "warning",
  done: "success",
};

/** The status of a task as a coloured label. The colour comes from the status kind, not its name. */
export function StatusBadge({ name, kind }: { name: string; kind: string }) {
  const tone = TONE_OF_KIND[kind as StatusKind] ?? "neutral";
  return (
    <Badge tone={tone} className="gap-1.5">
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {name}
    </Badge>
  );
}
