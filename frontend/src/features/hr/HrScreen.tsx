"use client";

import { Building2, Users } from "lucide-react";
import { useEffect, useState } from "react";

import { LoadingState, PageHeader, Tabs } from "@/components/ui";

import { listDepartments } from "./api";
import { DepartmentsPanel } from "./DepartmentsPanel";
import { ErrorMessage } from "./ErrorMessage";
import type { Department } from "./schema";
import { UsersPanel } from "./UsersPanel";

type State =
  | { kind: "loading" }
  | { kind: "error"; error: unknown }
  | { kind: "ready"; departments: Department[] };

type TabId = "employees" | "departments";

export function HrScreen() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState<TabId>("employees");

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

  if (state.kind === "loading") return <LoadingState>Loading…</LoadingState>;
  if (state.kind === "error") return <ErrorMessage error={state.error} />;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Human resources"
        description="Employees and the structure of the organization."
        className="mb-0"
      />
      <Tabs
        label="Human resources sections"
        idPrefix="hr"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "employees", label: "Employees", icon: Users },
          {
            id: "departments",
            label: "Departments",
            icon: Building2,
            count: state.departments.length,
          },
        ]}
      />
      {/* Both stay mounted, so a search or an open panel is still there when you come back. */}
      <div
        role="tabpanel"
        id="hr-panel-employees"
        aria-labelledby="hr-tab-employees"
        hidden={tab !== "employees"}
      >
        <UsersPanel departments={state.departments} />
      </div>
      <div
        role="tabpanel"
        id="hr-panel-departments"
        aria-labelledby="hr-tab-departments"
        hidden={tab !== "departments"}
      >
        <DepartmentsPanel
          departments={state.departments}
          onChanged={() => setReloadKey((value) => value + 1)}
        />
      </div>
    </div>
  );
}
