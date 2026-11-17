/** A titled group of fields inside a form or a panel, set off from the group above it. */
export function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      aria-label={title}
      className="grid gap-3 border-t border-dashed border-line-strong pt-3 first:border-t-0 first:pt-0"
    >
      <h3 className="m-0 text-[11px] font-semibold tracking-wider text-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}
