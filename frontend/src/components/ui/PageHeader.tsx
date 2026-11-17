import { cn } from "@/lib/cn";

type Props = {
  title: string;
  description?: string;
  /** Buttons or links shown on the right of the title. */
  actions?: React.ReactNode;
  className?: string;
};

/**
 * The top of a page. The title and the description are not drawn: the top bar already says where
 * the person is (the breadcrumb), so repeating them would only push the content down. They stay
 * in the page for screen readers and for the browser's outline (the title is the page's one
 * `h1`). Only the actions are shown, on the right; with none, nothing takes any room.
 */
export function PageHeader({ title, description, actions, className }: Props) {
  const text = (
    <>
      <h1 className="sr-only">{title}</h1>
      {description && <p className="sr-only">{description}</p>}
    </>
  );
  if (!actions) return text;
  return (
    <div className={cn("mb-5 flex flex-wrap items-center justify-end gap-3", className)}>
      {text}
      <div className="flex items-center gap-2">{actions}</div>
    </div>
  );
}
