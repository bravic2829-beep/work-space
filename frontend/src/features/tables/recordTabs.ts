import type { TabItem } from "@/components/ui";

export type RecordTab = "details" | "comments" | "history" | "access";

/** The sections of a task panel. A new record has only the form, so it shows no tabs. */
export const RECORD_TABS: TabItem<RecordTab>[] = [
  { id: "details", label: "Details" },
  { id: "comments", label: "Comments" },
  { id: "history", label: "History" },
  { id: "access", label: "Access" },
];
