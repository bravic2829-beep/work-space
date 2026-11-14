"use client";

import {
  FolderKanban,
  Grid2x2,
  Home,
  ListChecks,
  LogOut,
  Menu,
  Trash2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { Alert } from "@/components/ui";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/features/auth/AuthProvider";
import { isOrgAdmin } from "@/features/auth/schema";
import { NotificationBell } from "@/features/notifications/NotificationBell";

import { NavLink } from "./NavLink";

type NavItem = { href: string; label: string; icon: LucideIcon; adminOnly?: boolean };

const NAV: NavItem[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/my-tasks", label: "My tasks", icon: ListChecks },
  { href: "/workspaces", label: "Workspaces", icon: FolderKanban },
  { href: "/trash", label: "Trash", icon: Trash2 },
  { href: "/hr", label: "Human resources", icon: Users, adminOnly: true },
];

/** The section a page belongs to, for the breadcrumb ("/tables/x" is part of the workspaces). */
function sectionOf(pathname: string): string | null {
  if (pathname.startsWith("/tables/")) return "Workspaces";
  const match = NAV.find((item) =>
    item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  return match?.label ?? null;
}

/**
 * The frame of every signed-in page: a navigation sidebar on the left (a slide-in menu on a
 * phone), a slim top bar with the breadcrumb and the notification bell, and the page below.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { state, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  if (state.status !== "authenticated") return null;
  const user = state.user;
  const section = sectionOf(pathname);

  async function signOut() {
    setSigningOut(true);
    setError(null);
    try {
      await logout();
      router.replace("/login");
    } catch {
      setError("Could not sign out. Please try again.");
      setSigningOut(false);
    }
  }

  return (
    <div className="min-h-screen">
      {menuOpen && (
        <div
          aria-hidden
          className="fixed inset-0 z-40 bg-fg/30 md:hidden"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <aside
        aria-label="Sidebar"
        // Choosing a page closes the menu on a phone.
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) setMenuOpen(false);
        }}
        className={`fixed inset-y-0 left-0 z-50 w-60 flex-col justify-between border-r border-line bg-surface-muted p-2 md:z-30 md:flex ${menuOpen ? "flex" : "hidden"}`}
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 px-1 py-1">
            <span className="flex size-6 items-center justify-center rounded bg-primary text-primary-fg">
              <Grid2x2 className="size-3.5" aria-hidden />
            </span>
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-base font-semibold tracking-tight">WorkBase</span>
              <span className="truncate text-[11px] text-muted">Work management</span>
            </span>
          </div>

          <nav aria-label="Main" className="flex flex-col gap-0.5">
            <span className="px-2.5 py-1 text-[11px] font-medium tracking-wider text-muted uppercase">
              Navigation
            </span>
            {NAV.filter((item) => !item.adminOnly || isOrgAdmin(user)).map((item) => (
              <NavLink key={item.href} href={item.href} icon={item.icon}>
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2 border-t border-line px-1 pt-2">
          <Avatar name={user.full_name} />
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate text-[13px] font-medium">{user.full_name}</span>
            <span className="truncate font-mono text-[11px] text-muted">{user.employee_code}</span>
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Sign out"
            title="Sign out"
            onClick={() => void signOut()}
            disabled={signingOut}
          >
            <LogOut className="size-4" aria-hidden />
          </Button>
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-col md:pl-60">
        <header className="sticky top-0 z-20 flex h-11 items-center gap-2 border-b border-line bg-surface px-3">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label="Open menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
          >
            <Menu className="size-4" aria-hidden />
          </Button>
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px]">
            <span className="text-muted">WorkBase</span>
            {section && (
              <>
                <span aria-hidden className="text-line-strong">
                  /
                </span>
                <span aria-current="page" className="truncate font-semibold">
                  {section}
                </span>
              </>
            )}
          </nav>
          <div className="ml-auto">
            <NotificationBell />
          </div>
        </header>

        {error && (
          <div className="px-6 pt-4">
            <Alert>{error}</Alert>
          </div>
        )}
        <main className="mx-auto w-full max-w-[90rem] flex-1 px-4 py-5 md:px-6">{children}</main>
      </div>
    </div>
  );
}
