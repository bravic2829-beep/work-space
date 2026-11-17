import { cn } from "@/lib/cn";

/**
 * A list item drawn as a card whose whole surface is one link: put a link inside with
 * `after:absolute after:inset-0` and the link stretches over the card.
 */
export function LinkCard({ className, ...rest }: React.ComponentProps<"li">) {
  return (
    <li
      className={cn(
        "relative flex gap-3 border border-line bg-surface transition-colors hover:border-primary hover:bg-primary-soft/40",
        className,
      )}
      {...rest}
    />
  );
}
