"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError } from "@/lib/api/client";

import { useAuth } from "./AuthProvider";

function describe(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      const wait = error.retryAfterSeconds;
      return wait
        ? `Too many failed attempts. Try again in ${Math.ceil(wait / 60)} minute(s).`
        : "Too many failed attempts. Try again later.";
    }
    return error.message;
  }
  return "Something went wrong. Please try again.";
}

export function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const [employeeCode, setEmployeeCode] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(employeeCode.trim(), password, rememberMe);
      router.replace("/");
    } catch (caught) {
      setError(describe(caught));
      setPassword("");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="form" aria-label="Sign in">
      <label>
        Employee code
        <input
          name="employee_code"
          value={employeeCode}
          onChange={(event) => setEmployeeCode(event.target.value)}
          autoComplete="username"
          maxLength={50}
          required
        />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          maxLength={128}
          required
        />
      </label>
      <label className="inline">
        <input
          name="remember_me"
          type="checkbox"
          checked={rememberMe}
          onChange={(event) => setRememberMe(event.target.checked)}
        />
        Remember me for 7 days
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={submitting}>
        {submitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
