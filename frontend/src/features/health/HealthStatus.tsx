"use client";

import { CheckCircle2, RotateCw, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { Alert, Button, LoadingState } from "@/components/ui";

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
    return <LoadingState>Checking the backend…</LoadingState>;
  }

  if (state.kind === "error") {
    return (
      <Alert>
        <p className="m-0">Cannot reach the backend: {state.message}</p>
        <Button size="sm" icon={RotateCw} className="mt-2" onClick={retry}>
          Retry
        </Button>
      </Alert>
    );
  }

  const databaseOk = state.ready.database === "ok";
  return (
    <ul aria-label="Backend status" className="m-0 grid list-none gap-1.5 p-0 text-sm">
      <li className="flex items-center gap-2">
        <CheckCircle2 className="size-4 text-success" aria-hidden />
        API: ok
      </li>
      <li className="flex items-center gap-2">
        {databaseOk ? (
          <CheckCircle2 className="size-4 text-success" aria-hidden />
        ) : (
          <XCircle className="size-4 text-danger" aria-hidden />
        )}
        Database: {databaseOk ? "ok" : "unavailable"}
      </li>
    </ul>
  );
}
