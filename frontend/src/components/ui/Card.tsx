import { cn } from "@/lib/cn";

type Props = React.HTMLAttributes<HTMLDivElement> & {
  /** Remove the inner padding, for a table or list that touches the edges. */
  flush?: boolean;
};

/** A white (or dark) panel with a border: the container for a group of related content. */
export function Card({ flush = false, className, ...rest }: Props) {
  return (
    <div
      className={cn(
        "rounded-xl border border-line bg-surface shadow-sm",
        flush ? "overflow-hidden" : "p-5",
        className,
      )}
      {...rest}
    />
  );
}
