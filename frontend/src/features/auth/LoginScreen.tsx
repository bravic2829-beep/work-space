"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Alert, Card } from "@/components/ui";

import { useAuth } from "./AuthProvider";
import { LoginForm } from "./LoginForm";

/** The sign-in page. Someone who is already signed in goes straight to the home page. */
export function LoginScreen() {
  const { state } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (state.status === "authenticated") router.replace("/");
  }, [state.status, router]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-12">
      <div className="text-center">
        <p className="m-0 text-sm font-semibold tracking-tight text-primary">WorkBase</p>
        <h1 className="mt-1 mb-0">Sign in</h1>
        <p className="mt-1 text-sm text-muted">Use your employee code and password.</p>
      </div>
      {state.status === "error" && <Alert>Cannot reach the backend: {state.message}</Alert>}
      <Card>
        <LoginForm />
      </Card>
    </main>
  );
}
