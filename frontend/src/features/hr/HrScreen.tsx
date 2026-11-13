"use client";

import { useEffect, useState } from "react";

import { listDepartments } from "./api";
import { DepartmentsPanel } from "./DepartmentsPanel";
import { ErrorMessage } from "./ErrorMessage";
import type { Department } from "./schema";
import { UsersPanel } from "./UsersPanel";

type State =
  | { kind: "loading" }
  | { kind: "error"; error: unknown }
  | { kind: "ready"; departments: Department[] };

export function HrScreen() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const departments = await listDepartments(controller.signal);
        setState({ kind: "ready", departments });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({ kind: "error", error });
      }
    }

    void load();
    return () => controller.abort();
  }, [reloadKey]);

  if (state.kind === "loading") return <p role="status">Loading…</p>;
  if (state.kind === "error") return <ErrorMessage error={state.error} />;

  return (
    <>
      <h1>Human resources</h1>
      <DepartmentsPanel
        departments={state.departments}
        onChanged={() => setReloadKey((value) => value + 1)}
      />
      <UsersPanel departments={state.departments} />
    </>
  );
}
