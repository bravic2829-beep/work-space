import { Search } from "lucide-react";

import { cn } from "@/lib/cn";

import { Input } from "./controls";

/** A search box with a magnifier inside. `className` sets its size (for example `w-56`). */
export function SearchInput({ className, ...rest }: React.ComponentProps<"input">) {
  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted"
        aria-hidden
      />
      <Input type="search" className={cn("h-7 pl-7 text-[13px]", className)} {...rest} />
    </div>
  );
}
