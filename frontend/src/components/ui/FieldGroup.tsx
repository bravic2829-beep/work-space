/**
 * A labelled group of controls that is more than one input (a set of radio cards, a person
 * picker). Unlike FormField the label does not wrap the controls, so it does not become part of
 * each control's name.
 */
export function FieldGroup({
  label,
  hint,
  children,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-medium text-fg">{label}</span>
      {children}
      {hint && <p className="m-0 text-xs text-muted">{hint}</p>}
    </div>
  );
}
