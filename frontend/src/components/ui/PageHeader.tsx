import { cn } from "@/lib/cn";

type Props = {
  title: string;
  description?: string;
  /** Buttons or links shown on the right of the title. */
  actions?: React.ReactNode;
  className?: string;
};

/** The title block at the top of a page. */
export function PageHeader({ title, description, actions, className }: Props) {
  return (
    <div className={cn("mb-5 flex flex-wrap items-end justify-between gap-3", className)}>
      <div>
        <h1 className="m-0">{title}</h1>
        {description && <p className="mt-1 mb-0 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
