"use client";

import { LogIn } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Alert, Button, Checkbox, FormField, Input } from "@/components/ui";
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
    <form onSubmit={onSubmit} className="grid gap-4" aria-label="Sign in">
      <FormField label="Employee code">
        <Input
          name="employee_code"
          value={employeeCode}
          onChange={(event) => setEmployeeCode(event.target.value)}
          autoComplete="username"
          maxLength={50}
          required
        />
      </FormField>
      <FormField label="Password">
        <Input
          name="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          maxLength={128}
          required
        />
      </FormField>
      <Checkbox
        name="remember_me"
        label="Remember me for 7 days"
        checked={rememberMe}
        onChange={(event) => setRememberMe(event.target.checked)}
      />
      {error && <Alert>{error}</Alert>}
      <Button type="submit" variant="primary" icon={LogIn} disabled={submitting}>
        {submitting ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
