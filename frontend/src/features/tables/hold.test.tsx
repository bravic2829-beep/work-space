import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { describe as describeNotification, isNotification } from "@/features/notifications/schema";

import { reviewRecord } from "./api";
import { ASSIGNEE, DUE, NAME, makeField, makeRecord } from "./fixtures";

import { ReviewActions } from "./ReviewActions";
import type { FieldItem } from "./schema";
import { StatusStepper } from "./StatusStepper";
import { holdSteps, statusKind } from "./taskWorkflow";

vi.mock("./api", () => ({ reviewRecord: vi.fn() }));
const reviewMock = vi.mocked(reviewRecord);

const STATUS = makeField("f-status", "Status", "status", {
  semantic: "status",
  config: {
    options: [
      { id: "o-todo", name: "To do", kind: "todo" },
      { id: "o-doing", name: "In progress", kind: "in_progress" },
      { id: "o-review", name: "Pending review", kind: "review" },
      { id: "o-done", name: "Done", kind: "done" },
      { id: "o-paused", name: "Paused", kind: "paused" },
      { id: "o-blocked", name: "Blocked", kind: "blocked" },
    ],
  },
});
const DUE_DATE = { ...DUE, semantic: "due_date" };
const FIELDS: FieldItem[] = [NAME, ASSIGNEE, STATUS, DUE_DATE].map((f, position) => ({
  ...f,
  position,
}));

const ME = "u-me";
const BOSS = "u-boss";
const OTHER = "u-other";

function task(status: string | undefined, assignees = [ME], createdBy = BOSS) {
  return makeRecord(
    "r-1",
    { "f-name": "Launch", "f-assignee": assignees, ...(status ? { "f-status": status } : {}) },
    { created_by: createdBy },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("paused and blocked statuses", () => {
  it("knows the two new kinds", () => {
    expect(statusKind(FIELDS, task("o-paused"))).toBe("paused");
    expect(statusKind(FIELDS, task("o-blocked"))).toBe("blocked");
  });

  it("offers pause and a blocker while the work goes on", () => {
    for (const status of [undefined, "o-todo", "o-doing"]) {
      expect(holdSteps(FIELDS, task(status), ME).map((s) => s.action)).toEqual(["pause", "block"]);
    }
  });

  it("offers resume on a paused task, and unblock on a blocked one", () => {
    expect(holdSteps(FIELDS, task("o-paused"), ME).map((s) => s.label)).toEqual([
      "Resume",
      "Report a blocker",
    ]);
    expect(holdSteps(FIELDS, task("o-blocked"), ME).map((s) => s.label)).toEqual(["Unblock"]);
  });

  it("offers nothing on a task that waits for review or is done", () => {
    expect(holdSteps(FIELDS, task("o-review"), ME)).toEqual([]);
    expect(holdSteps(FIELDS, task("o-done"), ME)).toEqual([]);
  });

  it("is for the people who do the work or give it", () => {
    expect(holdSteps(FIELDS, task("o-doing"), BOSS)).toHaveLength(2); // the creator
    expect(holdSteps(FIELDS, task("o-doing"), OTHER, true)).toHaveLength(2); // a reviewer
    expect(holdSteps(FIELDS, task("o-doing"), OTHER, false, true)).toHaveLength(2); // an admin
    expect(holdSteps(FIELDS, task("o-doing"), OTHER)).toEqual([]); // somebody else
  });

  it("offers nothing without a status column", () => {
    expect(holdSteps([NAME, ASSIGNEE], task("o-doing"), ME)).toEqual([]);
  });
});

describe("ReviewActions for pausing and blocking", () => {
  function setup(record = task("o-doing"), who = ME) {
    const onChanged = vi.fn();
    render(
      <ReviewActions
        fields={FIELDS}
        record={record}
        currentUserId={who}
        onChanged={onChanged}
        onReload={vi.fn()}
      />,
    );
    return { onChanged, user: userEvent.setup() };
  }

  it("pauses at once, with the version being looked at", async () => {
    const updated = { ...task("o-paused"), version: 2 };
    reviewMock.mockResolvedValue(updated);
    const { onChanged, user } = setup();
    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(reviewMock).toHaveBeenCalledWith("r-1", 1, "pause");
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(updated));
  });

  it("asks what is blocking the task and sends the reason", async () => {
    reviewMock.mockResolvedValue(task("o-blocked"));
    const { onChanged, user } = setup();
    await user.click(screen.getByRole("button", { name: "Report a blocker" }));
    const send = screen.getByRole("button", { name: "Report this blocker" });
    expect(send).toBeDisabled(); // nothing typed yet
    await user.type(screen.getByLabelText("What is blocking this task?"), "  No price list  ");
    await user.click(send);
    expect(reviewMock).toHaveBeenCalledWith("r-1", 1, "block", "No price list");
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("keeps the reason when the server refuses", async () => {
    const { ApiError } = await import("@/lib/api/client");
    reviewMock.mockRejectedValue(new ApiError("The task is already blocked.", 409));
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Report a blocker" }));
    await user.type(screen.getByLabelText("What is blocking this task?"), "Waiting");
    await user.click(screen.getByRole("button", { name: "Report this blocker" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already blocked");
    expect(screen.getByLabelText("What is blocking this task?")).toHaveValue("Waiting");
  });

  it("resumes a blocked task with one click", async () => {
    reviewMock.mockResolvedValue(task("o-doing"));
    const { user } = setup(task("o-blocked"), BOSS);
    await user.click(screen.getByRole("button", { name: "Unblock" }));
    expect(reviewMock).toHaveBeenCalledWith("r-1", 1, "resume");
  });

  it("still shows send back with its own question for a task in review", async () => {
    const { user } = setup(task("o-review"), BOSS);
    await user.click(screen.getByRole("button", { name: "Send back" }));
    expect(screen.getByLabelText("What needs to change?")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
  });
});

describe("StatusStepper for paused and blocked", () => {
  it("keeps the task on In progress and says why it does not move", () => {
    const { rerender } = render(<StatusStepper fields={FIELDS} record={task("o-blocked")} />);
    const items = screen.getAllByRole("listitem");
    expect(items[1]).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("status")).toHaveTextContent("Blocked");
    rerender(<StatusStepper fields={FIELDS} record={task("o-paused")} />);
    expect(screen.getByRole("status")).toHaveTextContent("Paused");
    rerender(<StatusStepper fields={FIELDS} record={task("o-doing")} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("blocker notification", () => {
  it("is understood and described", () => {
    const note = {
      id: "n1",
      type: "task_blocked",
      record_id: "r-1",
      table_id: "t-1",
      record_name: "Launch",
      actor: { id: "u-1", full_name: "An" },
      read_at: null,
      created_at: "2026-11-17T08:00:00Z",
    };
    expect(isNotification(note)).toBe(true);
    expect(describeNotification(note as Parameters<typeof describeNotification>[0])).toBe(
      'An reported a blocker on "Launch"',
    );
  });
});

