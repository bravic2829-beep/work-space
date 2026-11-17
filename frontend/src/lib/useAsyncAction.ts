"use client";

import { useState } from "react";

/**
 * Runs one button's request: `busy` while it is under way, `message` with the problem when it
 * failed (cleared when the next run starts). `describeError` turns the failure into the words
 * shown to the person. The action itself handles what happens on success.
 */
export function useAsyncAction() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run(action: () => Promise<void>, describeError: (error: unknown) => string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage(describeError(error));
    } finally {
      setBusy(false);
    }
  }

  return { busy, message, run };
}
