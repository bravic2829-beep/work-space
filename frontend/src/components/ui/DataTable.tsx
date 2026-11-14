import { cn } from "@/lib/cn";

/**
 * A table in a rounded, scrollable frame. Put normal <thead>, <tbody>, <tr>, <th>, <td> inside;
 * the base styles in globals.css style the cells.
 */
export function DataTable({
  children,
  className,
  ...rest
}: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
      <table className={cn("m-0", className)} {...rest}>
        {children}
      </table>
    </div>
  );
}
