"use client";

import { FolderKanban, Home, ListChecks, LogOut, Trash2, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Alert } from "@/components/ui";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/features/auth/AuthProvider";
import { isOrgAdmin } from "@/features/auth/schema";
import { NotificationBell } from "@/features/notifications/NotificationBell";

import { NavLink } from "./NavLink";

/** Header with navigation and sign-out, shown on every signed-in page. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { state, logout } = useAuth();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.status !== "authenticated") return null;
  const user = state.user;

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
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-[90rem] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-2.5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="text-base font-semibold tracking-tight">WorkBase</span>
            <nav aria-label="Main" className="flex flex-wrap items-center gap-1">
              <NavLink href="/" icon={Home}>
                Home
              </NavLink>
              <NavLink href="/my-tasks" icon={ListChecks}>
                My tasks
              </NavLink>
              <NavLink href="/workspaces" icon={FolderKanban}>
                Workspaces
              </NavLink>
              <NavLink href="/trash" icon={Trash2}>
                Trash
              </NavLink>
              {isOrgAdmin(user) && (
                <NavLink href="/hr" icon={Users}>
                  Human resources
                </NavLink>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <NotificationBell />
            <span className="flex items-center gap-2 text-sm">
              <Avatar name={user.full_name} />
              <span>
                {user.full_name} ({user.employee_code})
              </span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              icon={LogOut}
              onClick={() => void signOut()}
              disabled={signingOut}
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>
      {error && (
        <div className="mx-auto max-w-[90rem] px-6 pt-4">
          <Alert>{error}</Alert>
        </div>
      )}
      <main className="mx-auto w-full max-w-[90rem] px-6 py-8">{children}</main>
    </>
  );
}
