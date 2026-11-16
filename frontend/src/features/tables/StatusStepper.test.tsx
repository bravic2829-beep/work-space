import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { makeField, makeRecord, NAME } from "./fixtures";
import { StatusStepper } from "./StatusStepper";

const STATUS = makeField("f-status", "Status", "status", {
  semantic: "status",
  config: {
    options: [
      { id: "s-todo", name: "Open", kind: "todo" },
      { id: "s-doing", name: "Working", kind: "in_progress" },
      { id: "s-review", name: "Checking", kind: "review" },
      { id: "s-done", name: "Finished", kind: "done" },
    ],
  },
});
const FIELDS = [NAME, STATUS];

function steps() {
  return within(screen.getByRole("list", { name: "Task progress" })).getAllByRole("listitem");
}

describe("StatusStepper", () => {
  it("marks the step the task is on, whatever the status is called", () => {
    render(<StatusStepper fields={FIELDS} record={makeRecord("r1", { "f-status": "s-review" })} />);
    const items = steps();
    expect(items.map((item) => item.textContent)).toEqual([
      "To do",
      "In progress",
      "Review",
      "Done",
    ]);
    expect(items[2]).toHaveAttribute("aria-current", "step");
    expect(items[0]).not.toHaveAttribute("aria-current");
  });

  it("treats a task with no status yet as to do", () => {
    render(<StatusStepper fields={FIELDS} record={makeRecord("r1", {})} />);
    expect(steps()[0]).toHaveAttribute("aria-current", "step");
  });

  it("puts a finished task on the last step", () => {
    render(<StatusStepper fields={FIELDS} record={makeRecord("r1", { "f-status": "s-done" })} />);
    expect(steps()[3]).toHaveAttribute("aria-current", "step");
  });

  it("draws nothing for a table without a status column", () => {
    const { container } = render(
      <StatusStepper fields={[NAME]} record={makeRecord("r1", {})} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
