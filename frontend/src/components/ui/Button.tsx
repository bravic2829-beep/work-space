import type { LucideIcon } from "lucide-react";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "icon";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "border-transparent bg-primary text-primary-fg hover:bg-primary-hover",
  secondary: "border-line-strong bg-surface text-fg hover:bg-surface-muted",
  ghost: "border-transparent bg-transparent text-fg hover:bg-surface-muted",
  danger: "border-transparent bg-danger text-white hover:opacity-90",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-3.5 py-1.5 text-sm",
  icon: "size-8 p-0",
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** An icon shown before the text (or alone, with size="icon" and an aria-label). */
  icon?: LucideIcon;
  /** Shows a spinner and blocks clicks while something is being saved. */
  loading?: boolean;
};

/** The one button of the app: pick a variant, optionally an icon. Never submits by accident. */
export function Button({
  variant = "secondary",
  size = "md",
  icon: Icon,
  loading = false,
  type = "button",
  className,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        Icon && <Icon className="size-4 shrink-0" aria-hidden />
      )}
      {children}
    </button>
  );
}
