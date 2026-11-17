"use client";

import { useState } from "react";

import { Button, Input } from "@/components/ui";

/** A random temporary password (no look-alike characters) the admin can read out. */
export function randomPassword(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

/**
 * A password the admin types or has made for them: Show to read it, Generate to fill in a random
 * one (which is then shown, so it can be told to the employee).
 */
export function PasswordInput({
  label,
  value,
  onChange,
  disabled,
  placeholder,
  required,
  onKeyDown,
}: {
  /** Names the input for screen readers (the buttons beside it are inside the same field). */
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  required?: boolean;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="flex gap-2">
      <Input
        aria-label={label}
        type={shown ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete="new-password"
        minLength={8}
        maxLength={128}
        required={required}
        disabled={disabled}
      />
      <Button onClick={() => setShown((current) => !current)} disabled={disabled}>
        {shown ? "Hide" : "Show"}
      </Button>
      <Button
        onClick={() => {
          onChange(randomPassword());
          setShown(true);
        }}
        disabled={disabled}
      >
        Generate
      </Button>
    </div>
  );
}
