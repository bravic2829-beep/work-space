"use client";

import { useState } from "react";

import {
  Alert,
  Button,
  Drawer,
  DrawerBody,
  DrawerFooter,
  FormField,
  Input,
} from "@/components/ui";

import { changePassword } from "./api";
import { errorMessage } from "@/lib/api/errors";

const MIN_LENGTH = 8;

type Props = { open: boolean; onClose: () => void };

/** Change my own password. The other devices are signed out; this one stays signed in. */
export function ChangePasswordDrawer({ open, onClose }: Props) {
  return (
    <Drawer open={open} title="Change password" onClose={onClose}>
      {/* A fresh form (empty fields, no old message) every time the drawer opens. */}
      {open && <ChangePasswordForm onClose={onClose} />}
    </Drawer>
  );
}

export function ChangePasswordForm({
  onClose,
  onChanged,
}: {
  /** Without it there is no Cancel button (the person has to change the password). */
  onClose?: () => void;
  onChanged?: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError("The new passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone(true);
      onChanged?.();
    } catch (caught) {
      setError(
        errorMessage(caught, "Could not change the password."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      aria-label="Change password"
      className="flex min-h-0 flex-1 flex-col"
    >
      <DrawerBody>
        <FormField label="Current password">
          <Input
            type="password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            autoComplete="current-password"
            maxLength={128}
            required
          />
        </FormField>
        <FormField
          label="New password"
          hint={`At least ${MIN_LENGTH} characters. Your other devices will be signed out.`}
        >
          <Input
            type="password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            autoComplete="new-password"
            minLength={MIN_LENGTH}
            maxLength={128}
            required
          />
        </FormField>
        <FormField label="Confirm new password">
          <Input
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
            minLength={MIN_LENGTH}
            maxLength={128}
            required
          />
        </FormField>
        {error && <Alert>{error}</Alert>}
        {done && <Alert tone="success">Your password was changed.</Alert>}
      </DrawerBody>
      <DrawerFooter>
        <Button type="submit" variant="primary" loading={busy}>
          Change password
        </Button>
        {onClose && (
          <Button onClick={onClose} disabled={busy}>
            {done ? "Close" : "Cancel"}
          </Button>
        )}
      </DrawerFooter>
    </form>
  );
}
