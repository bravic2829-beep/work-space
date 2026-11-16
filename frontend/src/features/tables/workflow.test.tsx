import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import { handOver, listActivity, type ActivityItem } from "./activity";
import { ActivityPanel } from "./ActivityPanel";
import { lookupUsers, reviewRecord, searchDirectory } from "./api";
import { ASSIGNEE, NAME, makeField, makeRecord } from "./fixtures";
import { HandoverForm } from "./HandoverForm";
import { ReviewActions } from "./ReviewActions";
import { reviewSteps } from "./taskWorkflow";
import { resetUserNames } from "./useUserNames";

vi.mock("./api", () => ({
  reviewRecord: vi.fn(),
  lookupUsers: vi.fn(),
  searchDirectory: vi.fn(),
}));
vi.mock("./activity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./activity")>()),
  listActivity: vi.fn(),
  handOver: vi.fn(),
}));

const STATUS = makeField("f-status", "Status", "status", {
  semantic: "status",
  config: {
    options: [
      { id: "o-doing", name: "In progress", kind: "in_progress" },
      { id: "o-review", name: "Pending review", kind: "review" },
    ],
  },
});
const FIELDS = [NAME, ASSIGNEE, STATUS].map((f, position) => ({ ...f, position }));
const ann = { id: "u-ann", employee_code: "A1", full_name: "Ann" };

beforeEach(() => {
  vi.resetAllMocks();
  resetUserNames();
  vi.mocked(lookupUsers).mockResolvedValue([ann]);
  vi.mocked(searchDirectory).mockResolvedValue([ann]);
});

describe("sending work back", () => {
  // Created by u-me ("the reviewer"), in review.
  const inReview = makeRecord("r-1", { "f-name": "Shopee", "f-status": "o-review", "f-assignee": ["u-x"] });

  function setup() {
    const onChanged = vi.fn();
    render(
      <ReviewActions
        fields={FIELDS}
        record={inReview}
        currentUserId="u-me"
        onChanged={onChanged}
        onReload={vi.fn()}
      />,
    );
    return { onChanged, user: userEvent.setup() };
  }

  it("asks what needs to change and sends it with the reason", async () => {
    const back = { ...inReview, version: 2 };
    vi.mocked(reviewRecord).mockResolvedValue(back);
    const { user, onChanged } = setup();
    await user.click(screen.getByRole("button", { name: "Send back" }));
    const send = screen.getByRole("button", { name: "Send back with this reason" });
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText("What needs to change?"), "  Add the refunds ");
    await user.click(send);
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(back));
    expect(reviewRecord).toHaveBeenCalledWith("r-1", 1, "reject", "Add the refunds");
  });

  it("approves without asking anything", async () => {
    vi.mocked(reviewRecord).mockResolvedValue(inReview);
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(reviewRecord).toHaveBeenCalledWith("r-1", 1, "approve"));
  });

  it("keeps the reason when the server refuses", async () => {
    vi.mocked(reviewRecord).mockRejectedValue(new ApiError("Server is down.", 500));
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Send back" }));
    await user.type(screen.getByLabelText("What needs to change?"), "Add the refunds");
    await user.click(screen.getByRole("button", { name: "Send back with this reason" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Server is down.");
    expect(screen.getByLabelText("What needs to change?")).toHaveValue("Add the refunds");
  });
});

describe("the admin", () => {
  const doing = makeRecord(
    "r-1",
    { "f-name": "Shopee", "f-status": "o-doing", "f-assignee": ["u-x"] },
    { created_by: "u-other" },
  );
  const waiting = { ...doing, data: { ...doing.data, "f-status": "o-review" } };

  it("may report any task as done and review any task", () => {
    expect(reviewSteps(FIELDS, doing, "u-admin", false, true).map((s) => s.action)).toEqual([
      "submit",
    ]);
    expect(reviewSteps(FIELDS, waiting, "u-admin", false, true).map((s) => s.action)).toEqual([
      "approve",
      "reject",
    ]);
    // Somebody else with no part in the task gets nothing.
    expect(reviewSteps(FIELDS, doing, "u-nobody")).toEqual([]);
    expect(reviewSteps(FIELDS, waiting, "u-nobody")).toEqual([]);
  });

  it("sees the buttons in the task panel", () => {
    render(
      <ReviewActions
        fields={FIELDS}
        record={waiting}
        currentUserId="u-admin"
        admin
        onChanged={vi.fn()}
        onReload={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send back" })).toBeInTheDocument();
  });
});

describe("HandoverForm", () => {
  const task = makeRecord("r-1", { "f-name": "Count stock", "f-assignee": ["u-me"] }, { version: 4 });

  async function open() {
    const onChanged = vi.fn();
    render(<HandoverForm record={task} onChanged={onChanged} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Hand over" }));
    return { onChanged, user };
  }

  it("needs a person and what was done, then sends both with the documents", async () => {
    const moved = { ...task, version: 5 };
    vi.mocked(handOver).mockResolvedValue(moved);
    const { user, onChanged } = await open();
    const form = screen.getByRole("form", { name: "Hand over" });
    const send = within(form).getByRole("button", { name: "Hand over" });
    expect(send).toBeDisabled();

    await user.type(screen.getByLabelText("Find an employee for Hand over to"), "a");
    await user.click(await screen.findByRole("button", { name: "Add Ann (A1)" }));
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText("What was done"), "Zones A and B counted.");
    await user.type(screen.getByLabelText("Documents"), "stock.xlsx");
    await user.click(send);

    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(moved));
    expect(handOver).toHaveBeenCalledWith("r-1", 4, {
      to_user_id: "u-ann",
      result: "Zones A and B counted.",
      documents: "stock.xlsx",
    });
  });

  it("explains a refusal and keeps what was typed", async () => {
    vi.mocked(handOver).mockRejectedValue(
      new ApiError("This person cannot open the table. Add them to a sheet or the workspace first.", 422),
    );
    const { user } = await open();
    await user.type(screen.getByLabelText("Find an employee for Hand over to"), "a");
    await user.click(await screen.findByRole("button", { name: "Add Ann (A1)" }));
    await user.type(screen.getByLabelText("What was done"), "Half done.");
    const form = screen.getByRole("form", { name: "Hand over" });
    await user.click(within(form).getByRole("button", { name: "Hand over" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("cannot open the table");
    expect(screen.getByLabelText("What was done")).toHaveValue("Half done.");
  });
});

describe("ActivityPanel", () => {
  const entries: ActivityItem[] = [
    {
      id: "a-3",
      action: "sent_back",
      actor: { id: "u-boss", full_name: "Boss" },
      created_at: "2026-11-14T03:00:00Z",
      changes: [{ field_id: "f-status", field_name: "Status", before: "o-review", after: "o-doing" }],
      note: "Add the refunds.",
    },
    {
      id: "a-2",
      action: "updated",
      actor: { id: "u-me", full_name: "Me" },
      created_at: "2026-11-14T02:00:00Z",
      changes: [{ field_id: "f-assignee", field_name: "Assignee", before: null, after: ["u-ann"] }],
      note: null,
    },
    {
      id: "a-1",
      action: "created",
      actor: { id: "u-me", full_name: "Me" },
      created_at: "2026-11-14T01:00:00Z",
      changes: [{ field_id: "f-name", field_name: "Name", before: null, after: "Shopee" }],
      note: null,
    },
  ];

  it("tells the story of the task in words, newest first", async () => {
    vi.mocked(listActivity).mockResolvedValue(entries);
    render(<ActivityPanel recordId="r-1" version={3} fields={FIELDS} />);
    const list = await screen.findByRole("list", { name: "History of this task" });
    const rows = within(list).getAllByRole("listitem", { hidden: false }).filter((li) => li.parentElement === list);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Boss sent it back");
    expect(rows[0]).toHaveTextContent("Status: Pending review → In progress");
    expect(rows[0]).toHaveTextContent("Add the refunds.");
    expect(await within(rows[1]).findByText(/Ann \(A1\)/)).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent("Assignee: empty →");
    // Creating lists no changes, only that it happened.
    expect(rows[2]).toHaveTextContent("Me created the task");
    expect(rows[2]).not.toHaveTextContent("Name:");
  });

  it("says so when there is nothing, or when the history cannot be loaded", async () => {
    vi.mocked(listActivity).mockResolvedValueOnce([]);
    const { unmount } = render(<ActivityPanel recordId="r-1" version={1} fields={FIELDS} />);
    expect(await screen.findByText("Nothing has happened yet.")).toBeInTheDocument();
    unmount();
    vi.mocked(listActivity).mockRejectedValueOnce(new Error("offline"));
    render(<ActivityPanel recordId="r-1" version={1} fields={FIELDS} />);
    expect(await screen.findByText(/Could not load the history/)).toBeInTheDocument();
  });
});
