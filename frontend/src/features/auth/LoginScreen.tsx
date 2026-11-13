"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

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
    <main className="container">
      <h1>Sign in</h1>
      {state.status === "error" && (
        <p role="alert">Cannot reach the backend: {state.message}</p>
      )}
      <LoginForm />
    </main>
  );
}
