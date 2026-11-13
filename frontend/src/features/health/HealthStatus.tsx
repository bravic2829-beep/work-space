"use client";

import { useEffect, useState } from "react";

import { fetchHealth, fetchReady } from "./api";
import type { ReadyResponse } from "./schema";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; ready: ReadyResponse };

export function HealthStatus() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        await fetchHealth(controller.signal);
        const ready = await fetchReady(controller.signal);
        setState({ kind: "loaded", ready });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          kind: "error",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    void load();
    return () => controller.abort();
  }, [attempt]);

  function retry() {
    setState({ kind: "loading" });
    setAttempt((value) => value + 1);
  }

  if (state.kind === "loading") {
    return <p role="status">Checking the backend…</p>;
  }

  if (state.kind === "error") {
    return (
      <div role="alert">
        <p>Cannot reach the backend: {state.message}</p>
        <button type="button" onClick={retry}>
          Retry
        </button>
      </div>
    );
  }

  const databaseOk = state.ready.database === "ok";
  return (
    <ul aria-label="Backend status">
      <li>API: ok</li>
      <li>Database: {databaseOk ? "ok" : "unavailable"}</li>
    </ul>
  );
}
