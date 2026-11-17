import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { localToday } from "@/features/mytasks/schema";

import { ASSIGNEE, DUE, NAME, makeField, makeRecord } from "./fixtures";
import { TaskCounts } from "./TaskCounts";

const STATUS = makeField("f-status", "Status", "status", {
  semantic: "status",
  config: {
    options: [
      { id: "s-todo", name: "To do", kind: "todo" },
      { id: "s-review", name: "Pending review", kind: "review" },
      { id: "s-done", name: "Done", kind: "done" },
    ],
  },
});
const DUE_DATE = { ...DUE, semantic: "due_date" };
const FIELDS = [NAME, ASSIGNEE, STATUS, DUE_DATE];
const LATE = "2000-01-01";

function count(label: string): string {
  const item = screen.getByText(label).closest("li") as HTMLElement;
  return within(item).getByText(/^\d+\+?$/).textContent ?? "";
}

describe("TaskCounts", () => {
  it("counts open, pending review, overdue and done tasks", () => {
    render(
      <TaskCounts
        fields={FIELDS}
        hasMore={false}
        records={[
          makeRecord("a", { "f-status": "s-todo", "f-due": LATE }),
          makeRecord("b", { "f-status": "s-review", "f-due": localToday() }),
          makeRecord("c", { "f-status": "s-done", "f-due": LATE }),
          makeRecord("d", {}),
        ]}
      />,
    );
    expect(count("Open")).toBe("3");
    expect(count("Pending review")).toBe("1");
    // A finished task is never overdue.
    expect(count("Overdue")).toBe("1");
    expect(count("Done")).toBe("1");
  });

  it("adds a plus when more rows can be loaded", () => {
    render(<TaskCounts fields={FIELDS} hasMore records={[makeRecord("a", {})]} />);
    expect(count("Open")).toBe("1+");
  });

  it("draws nothing for a table without a status column", () => {
    const { container } = render(<TaskCounts fields={[NAME]} hasMore={false} records={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
