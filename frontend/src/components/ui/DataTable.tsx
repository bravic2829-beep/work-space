import { cn } from "@/lib/cn";

type Props = React.TableHTMLAttributes<HTMLTableElement> & {
  /** Rows 32px high with a hover highlight, like the grid of the design. For long lists. */
  dense?: boolean;
  /**
   * Keeps the header row and the first column in view while the table scrolls, inside a frame
   * that is at most 70% of the window high. Mark the open row with aria-selected="true".
   */
  sticky?: boolean;
};

/**
 * A table in a rounded, scrollable frame. Put normal <thead>, <tbody>, <tr>, <th>, <td> inside;
 * the base styles in globals.css style the cells.
 */
export function DataTable({
  children,
  className,
  dense = false,
  sticky = false,
  ...rest
}: Props) {
  return (
    <div
      className={cn(
        "border border-line bg-surface",
        sticky ? "max-h-[70vh] overflow-auto" : "overflow-x-auto",
        dense ? "rounded-lg" : "rounded-xl shadow-sm",
      )}
    >
      <table
        className={cn(
          "m-0",
          dense &&
            "[&_td]:h-8 [&_td]:py-0 [&_td]:align-middle [&_td]:whitespace-nowrap [&_th]:h-8 [&_th]:py-0 [&_th]:whitespace-nowrap [&_tr:last-child>td]:border-b-0 [&_tbody_tr:hover]:bg-surface-muted",
          sticky &&
            "[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_th:first-child]:left-0 [&_th:first-child]:z-20 [&_tbody_tr]:bg-surface [&_tbody_td:first-child]:sticky [&_tbody_td:first-child]:left-0 [&_tbody_td:first-child]:z-[5] [&_tbody_td:first-child]:bg-inherit [&_tbody_tr[aria-selected=true]]:bg-primary-soft [&_tbody_tr[aria-selected=true]_td:first-child]:shadow-[inset_3px_0_0_var(--color-primary)]",
          className,
        )}
        {...rest}
      >
        {children}
      </table>
    </div>
  );
}
