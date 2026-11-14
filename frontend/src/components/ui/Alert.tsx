import { AlertCircle, CheckCircle2, Info, TriangleAlert, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/cn";

import { TONES, type Tone } from "./Badge";

const ICONS: Record<Tone, LucideIcon> = {
  neutral: Info,
  info: Info,
  success: CheckCircle2,
  warning: TriangleAlert,
  danger: AlertCircle,
};

type Props = {
  /** danger (default) and warning are announced at once (role "alert"); the others politely. */
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
};

/** A message box: an error, a warning, or a note. */
export function Alert({ tone = "danger", children, className }: Props) {
  const Icon = ICONS[tone];
  return (
    <div
      role={tone === "danger" || tone === "warning" ? "alert" : "status"}
      className={cn("flex items-start gap-2 rounded-lg px-3 py-2 text-sm", TONES[tone], className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
