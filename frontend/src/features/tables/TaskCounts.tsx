import { AlertTriangle, CheckCircle2, ClipboardCheck, ListTodo } from "lucide-react";

import { StatCard } from "@/components/ui";
import { dueInfo, localToday } from "@/features/mytasks/schema";

import type { FieldItem, RecordItem } from "./schema";
import { fieldBySemantic, statusKind } from "./taskWorkflow";

/**
 * Open, pending review, overdue and done, counted over the rows that are loaded (a "+" says there
 * are more rows to load). Nothing is drawn for a table without a status column.
 */
export function TaskCounts({
  fields,
  records,
  hasMore,
}: {
  fields: FieldItem[];
  records: RecordItem[];
  hasMore: boolean;
}) {
  if (fieldBySemantic(fields, "status") === undefined) return null;
  const dueField = fieldBySemantic(fields, "due_date");
  const today = localToday();

  let open = 0;
  let review = 0;
  let overdue = 0;
  let done = 0;
  for (const record of records) {
    const kind = statusKind(fields, record);
    if (kind === "done") {
      done += 1;
      continue;
    }
    open += 1;
    if (kind === "review") review += 1;
    const due = dueField ? record.data[dueField.id] : undefined;
    if (typeof due === "string" && dueInfo(due, today)?.tone === "overdue") overdue += 1;
  }
  const more = hasMore ? "+" : "";

  return (
    <ul
      aria-label="Task counts"
      className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3 p-0"
    >
      <StatCard label="Open" value={`${open}${more}`} icon={ListTodo} tone="info" />
      <StatCard label="Pending review" value={`${review}${more}`} icon={ClipboardCheck} tone="warning" />
      <StatCard label="Overdue" value={`${overdue}${more}`} icon={AlertTriangle} tone="danger" />
      <StatCard label="Done" value={`${done}${more}`} icon={CheckCircle2} tone="success" />
    </ul>
  );
}
