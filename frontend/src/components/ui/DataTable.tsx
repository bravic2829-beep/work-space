import { cn } from "@/lib/cn";

type Props = React.TableHTMLAttributes<HTMLTableElement> & {
  /** Rows 32px high with a hover highlight, like the grid of the design. For long lists. */
  dense?: boolean;
};

/**
 * A table in a rounded, scrollable frame. Put normal <thead>, <tbody>, <tr>, <th>, <td> inside;
 * the base styles in globals.css style the cells.
 */
export function DataTable({ children, className, dense = false, ...rest }: Props) {
  return (
    <div
      className={cn(
        "overflow-x-auto border border-line bg-surface",
        dense ? "rounded-lg" : "rounded-xl shadow-sm",
      )}
    >
      <table
        className={cn(
          "m-0",
          dense &&
            "[&_td]:h-8 [&_td]:py-0 [&_td]:align-middle [&_td]:whitespace-nowrap [&_th]:h-8 [&_th]:py-0 [&_th]:whitespace-nowrap [&_tr:last-child>td]:border-b-0 [&_tbody_tr:hover]:bg-surface-muted/70",
          className,
        )}
        {...rest}
      >
        {children}
      </table>
    </div>
  );
}
