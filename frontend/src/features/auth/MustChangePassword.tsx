"use client";

import { useState } from "react";

import { Alert, Button } from "@/components/ui";

import { useAuth } from "./AuthProvider";
import { ChangePasswordForm } from "./ChangePasswordDrawer";

/**
 * Shown instead of the whole app while the account still has a temporary password set by an admin.
 * The backend refuses everything else too, so this is only the friendly side of that rule.
 */
export function MustChangePassword() {
  const { refresh, logout } = useAuth();
  const [error, setError] = useState<string | null>(null);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4">
      <header>
        <h1 className="m-0 text-xl font-semibold">Choose a new password</h1>
        <p className="m-0 mt-1 text-sm text-muted">
          An admin gave you a temporary password. Choose your own to continue.
        </p>
      </header>
      <div className="flex flex-col rounded border border-line bg-surface">
        <ChangePasswordForm
          onChanged={() => {
            setError(null);
            // The password is changed even if reading the user again fails; then a reload helps.
            refresh().catch(() =>
              setError(
                "Your password was changed. Reload the page to continue.",
              ),
            );
          }}
        />
      </div>
      {error && <Alert>{error}</Alert>}
      <div>
        <Button variant="ghost" onClick={() => void logout()}>
          Sign out
        </Button>
      </div>
    </main>
  );
}
