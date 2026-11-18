"use client";

import { useState } from "react";

import { Tabs, type TabItem } from "@/components/ui";
import { OkrScreen } from "@/features/okr/OkrScreen";

import { OverviewScreen } from "./OverviewScreen";
import { ReportsScreen } from "./ReportsScreen";

type Section = "overview" | "okr" | "tasks";

const SECTIONS: TabItem<Section>[] = [
  { id: "overview", label: "Overview" },
  { id: "okr", label: "OKR" },
  { id: "tasks", label: "Task overview" },
];

/**
 * Reports: the overview (ten numbers, the weekly trend, the work per project and per person), the
 * OKR of the company, the teams and each person, and (as before) the overview of one task table:
 * what is late, what waits for review, who carries what.
 */
export function ReportsHub() {
  const [section, setSection] = useState<Section>("overview");
  return (
    <div className="grid gap-4">
      <Tabs label="Reports" idPrefix="reports" tabs={SECTIONS} value={section} onChange={setSection} />
      <div role="tabpanel" id={`reports-panel-${section}`} aria-labelledby={`reports-tab-${section}`}>
        {section === "overview" && <OverviewScreen />}
        {section === "okr" && <OkrScreen />}
        {section === "tasks" && <ReportsScreen />}
      </div>
    </div>
  );
}
