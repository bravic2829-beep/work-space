import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { localToday } from "@/features/mytasks/schema";

import { NAME, makeField, makeRecord } from "./fixtures";
import { RecordGrid } from "./RecordGrid";

const DUE = makeField("f-due", "Due date", "date", {
  semantic: "due_date",
  config: { include_time: false },
});
const STATUS = makeField("f-status", "Status", "status", {
  semantic: "status",
  config: {
    options: [
      { id: "s-todo", name: "To do", kind: "todo" },
      { id: "s-done", name: "Done", kind: "done" },
    ],
  },
});
const FIELDS = [NAME, DUE, STATUS].map((f, position) => ({ ...f, position }));

function renderGrid(data: Record<string, unknown>) {
  render(
    <RecordGrid
      fields={FIELDS}
      records={[makeRecord("r-1", { "f-name": "Task", ...data })]}
      names={new Map()}
      sort={[]}
      selectedId={null}
      hasMore={false}
      loadingMore={false}
      onSort={vi.fn()}
      onSelect={vi.fn()}
      onLoadMore={vi.fn()}
    />,
  );
}

describe("the due date column of a task table", () => {
  it("says Today, in words, for a task due today", () => {
    renderGrid({ "f-due": localToday(), "f-status": "s-todo" });
    expect(screen.getByText("Today")).toBeInTheDocument();
  });

  it("flags a task that is late", () => {
    renderGrid({ "f-due": "2000-01-01", "f-status": "s-todo" });
    expect(screen.getByText(/^Overdue \d+ days$/)).toBeInTheDocument();
  });

  it("does not call a finished task late", () => {
    renderGrid({ "f-due": "2000-01-01", "f-status": "s-done" });
    expect(screen.getByText("2000-01-01")).toBeInTheDocument();
    expect(screen.queryByText(/Overdue/)).not.toBeInTheDocument();
  });

  it("leaves a date far away as the plain date", () => {
    renderGrid({ "f-due": "2099-05-06", "f-status": "s-todo" });
    expect(screen.getByText("2099-05-06")).toBeInTheDocument();
  });
});
