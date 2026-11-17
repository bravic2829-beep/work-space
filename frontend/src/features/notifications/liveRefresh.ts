"use client";

import { useEffect, useRef } from "react";

type Listener = () => void;
const listeners = new Set<Listener>();

/** Tell every screen that listens that something may have changed for this person. */
export function emitLiveChange(): void {
  listeners.forEach((listener) => listener());
}

/** Listen outside a component; returns the function that stops listening. */
export function subscribeLive(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Run `onChange` whenever the live socket says something changed for the signed-in person (for
 * example a task was given to them), so a list on screen can fetch itself again at once. The
 * socket only carries the signal; `onChange` should read the data through the API as usual.
 */
export function useLiveRefresh(onChange: () => void): void {
  const callback = useRef(onChange);
  useEffect(() => {
    callback.current = onChange;
  });
  useEffect(() => {
    return subscribeLive(() => callback.current());
  }, []);
}
