import { cn } from "@/lib/cn";

const BASE =
  "w-full rounded-md border bg-surface px-2.5 py-1.5 text-sm text-fg placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-60";

function border(invalid?: boolean): string {
  return invalid ? "border-danger" : "border-line-strong";
}

type Invalid = { invalid?: boolean };

export function Input({
  invalid,
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & Invalid) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(BASE, border(invalid), className)}
      {...rest}
    />
  );
}

export function Textarea({
  invalid,
  className,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & Invalid) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cn(BASE, border(invalid), className)}
      {...rest}
    />
  );
}

export function Select({
  invalid,
  className,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & Invalid) {
  return (
    <select
      aria-invalid={invalid || undefined}
      className={cn(BASE, border(invalid), className)}
      {...rest}
    />
  );
}

/** A checkbox with its text, in one clickable label. */
export function Checkbox({
  label,
  className,
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & { label: string }) {
  return (
    <label className={cn("flex items-center gap-2 text-sm", className)}>
      <input type="checkbox" className="size-4" {...rest} />
      {label}
    </label>
  );
}
