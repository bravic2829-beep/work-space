import { cn } from "@/lib/cn";

type Props = {
  label: string;
  /** The control: an Input, Select or Textarea. It is wrapped by the label, so clicking the text focuses it. */
  children: React.ReactNode;
  hint?: string;
  /** Shown under the control and announced to screen readers. */
  error?: string | null;
  className?: string;
};

/** A labelled form control with an optional hint and error message. */
export function FormField({ label, children, hint, error, className }: Props) {
  return (
    <div className={cn("grid gap-1", className)}>
      <label className="grid gap-1.5 text-sm font-medium text-fg">
        {label}
        {children}
      </label>
      {hint && <p className="m-0 text-xs text-muted">{hint}</p>}
      {error && (
        <p role="alert" className="m-0 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
