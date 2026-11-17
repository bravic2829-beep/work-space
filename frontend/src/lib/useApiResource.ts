"use client";

import { useEffect, useState, type DependencyList } from "react";

import { errorMessage } from "./api/errors";

export type Resource<T> =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: T };

/**
 * Reads something from the API when the component appears and again whenever `deps` change. The
 * old answer stays on screen until the new one arrives. A request that is no longer wanted is
 * cancelled, and its failure is ignored.
 */
export function useApiResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  failure: string,
  deps: DependencyList,
): Resource<T> {
  const [state, setState] = useState<Resource<T>>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal)
      .then((data) => setState({ kind: "ready", data }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState({ kind: "error", message: errorMessage(error, failure) });
        }
      });
    return () => controller.abort();
    // `load` and `failure` are written inline by the caller; `deps` says when to read again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
