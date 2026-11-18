"use client";

import { useState } from "react";

import { Tabs, type TabItem } from "@/components/ui";
import { OkrScreen } from "@/features/okr/OkrScreen";

import { ReportsScreen } from "./ReportsScreen";

type Section = "okr" | "tasks";

const SECTIONS: TabItem<Section>[] = [
  { id: "okr", label: "OKR" },
  { id: "tasks", label: "Task overview" },
];

/**
 * Reports: the OKR of the company, the teams and each person, and (as before) the overview of a
 * task table: what is late, what waits for review, who carries what.
 */
export function ReportsHub() {
  const [section, setSection] = useState<Section>("okr");
  return (
    <div className="grid gap-4">
      <Tabs label="Reports" idPrefix="reports" tabs={SECTIONS} value={section} onChange={setSection} />
      <div role="tabpanel" id={`reports-panel-${section}`} aria-labelledby={`reports-tab-${section}`}>
        {section === "okr" ? <OkrScreen /> : <ReportsScreen />}
      </div>
    </div>
  );
}
