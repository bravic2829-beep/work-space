import { cn } from "@/lib/cn";

import { Avatar } from "./Avatar";

/** One person in a list: a bordered row for their name and whatever goes with it. */
export function PersonRow({ className, ...rest }: React.ComponentProps<"li">) {
  return (
    <li
      className={cn(
        "flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5",
        className,
      )}
      {...rest}
    />
  );
}

/** Avatar, name and employee code, stacked. Takes the free room of the row. */
export function PersonIdentity({ name, code }: { name: string; code: string }) {
  return (
    <>
      <Avatar name={name} />
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-[13px] font-medium">{name}</span>
        <span className="truncate font-mono text-[11px] text-muted">{code}</span>
      </span>
    </>
  );
}
