"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useAuth } from "@/features/auth/AuthProvider";
import { isOrgAdmin } from "@/features/auth/schema";

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
      <header className="app-header">
        <nav aria-label="Main">
          <Link href="/">Home</Link>
          <Link href="/workspaces">Workspaces</Link>
          {isOrgAdmin(user) && <Link href="/hr">Human resources</Link>}
        </nav>
        <div>
          <span>
            {user.full_name} ({user.employee_code})
          </span>{" "}
          <button type="button" onClick={() => void signOut()} disabled={signingOut}>
            Sign out
          </button>
        </div>
      </header>
      {error && <p role="alert">{error}</p>}
      <main className="container wide">{children}</main>
    </>
  );
}
