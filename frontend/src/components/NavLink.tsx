"use client";

import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";

type Props = {
  href: string;
  icon: LucideIcon;
  children: string;
  /** Highlight for every path under href, not only the exact one (default for all but "/"). */
  exact?: boolean;
};

/** A link of the main navigation. The page you are on is highlighted and marked for screen readers. */
export function NavLink({ href, icon: Icon, children, exact = href === "/" }: Props) {
  const pathname = usePathname() ?? "";
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium no-underline transition-colors hover:no-underline",
        active ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface-muted hover:text-fg",
      )}
    >
      <Icon className="size-4" aria-hidden />
      {children}
    </Link>
  );
}
