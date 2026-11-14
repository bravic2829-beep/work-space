import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import {
  createComment,
  createRecord,
  deleteComment,
  listComments,
  lookupUsers,
  reviewRecord,
  searchDirectory,
} from "./api";
import { CommentsPanel } from "./CommentsPanel";
import { ASSIGNEE, NAME, makeField, makeRecord } from "./fixtures";
import { ReviewActions } from "./ReviewActions";
import type { CommentItem, FieldItem } from "./schema";
import { SubtaskForm } from "./SubtaskForm";
import { assigneeIds, reviewSteps, statusKind, titleField } from "./taskWorkflow";
import { resetUserNames } from "./useUserNames";

vi.mock("./api", () => ({
  reviewRecord: vi.fn(),
  listComments: vi.fn(),
  createComment: vi.fn(),
  deleteComment: vi.fn(),
  createRecord: vi.fn(),
  lookupUsers: vi.fn(),
  searchDirectory: vi.fn(),
}));

const reviewMock = vi.mocked(reviewRecord);
const listMock = vi.mocked(listComments);
const createCommentMock = vi.mocked(createComment);
const deleteCommentMock = vi.mocked(deleteComment);
const createRecordMock = vi.mocked(createRecord);

const STATUS = makeField("f-status", "Status", "status", {
  semantic: "status",
  config: {
    options: [
      { id: "o-todo", name: "To do", kind: "todo" },
      { id: "o-doing", name: "In progress", kind: "in_progress" },
      { id: "o-review", name: "Pending review", kind: "review" },
      { id: "o-done", name: "Done", kind: "done" },
    ],
  },
});
const PARENT = makeField("f-parent", "Parent task", "link_record", {
  semantic: "parent",
  config: { table_id: "t-1", multiple: false },
});
const FIELDS: FieldItem[] = [NAME, ASSIGNEE, STATUS, PARENT].map((f, position) => ({
  ...f,
  position,
}));

const ME = "u-me";
const BOSS = "u-boss";

function task(status: string | undefined, assignees: string[], createdBy = BOSS) {
  return makeRecord(
    "r-1",
    {
      "f-name": "Launch",
      "f-assignee": assignees,
      ...(status ? { "f-status": status } : {}),
    },
    { created_by: createdBy },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  resetUserNames();
  vi.mocked(lookupUsers).mockResolvedValue([]);
  vi.mocked(searchDirectory).mockResolvedValue([]);
});

describe("task workflow rules", () => {
  it("reads the status kind, with 'todo' when nothing is chosen", () => {
    expect(statusKind(FIELDS, task("o-review", []))).toBe("review");
    expect(statusKind(FIELDS, task(undefined, []))).toBe("todo");
    expect(statusKind(FIELDS, task("o-unknown", []))).toBe("todo");
    expect(statusKind([NAME], task("o-done", []))).toBeNull();
  });

  it("finds the assignees and the title column", () => {
    expect(assigneeIds(FIELDS, task("o-doing", [ME, "u-2"]))).toEqual([ME, "u-2"]);
    expect(assigneeIds([NAME], task("o-doing", [ME]))).toEqual([]);
    expect(titleField(FIELDS)?.id).toBe("f-name");
  });

  it("offers 'report as done' to an assignee of an unfinished task", () => {
    for (const status of ["o-todo", "o-doing", undefined]) {
      expect(reviewSteps(FIELDS, task(status, [ME]), ME).map((s) => s.action)).toEqual(["submit"]);
    }
  });

  it("offers approve and send back to the creator of a task in review", () => {
    expect(reviewSteps(FIELDS, task("o-review", [ME]), BOSS).map((s) => s.action)).toEqual([
      "approve",
      "reject",
    ]);
  });

  it("offers nothing that is certain to be refused", () => {
    // Not assigned, already waiting, already done, not the creator, no status column.
    expect(reviewSteps(FIELDS, task("o-doing", ["u-2"]), ME)).toEqual([]);
    expect(reviewSteps(FIELDS, task("o-review", [ME]), ME)).toEqual([]);
    expect(reviewSteps(FIELDS, task("o-done", [ME]), ME)).toEqual([]);
    expect(reviewSteps(FIELDS, task("o-doing", [ME]), BOSS)).toEqual([]);
    expect(reviewSteps([NAME, ASSIGNEE], task("o-doing", [ME]), ME)).toEqual([]);
  });
});

describe("ReviewActions", () => {
  function setup(record = task("o-doing", [ME]), who = ME) {
    const onChanged = vi.fn();
    const onReload = vi.fn();
    render(
      <ReviewActions
        fields={FIELDS}
        record={record}
        currentUserId={who}
        onChanged={onChanged}
        onReload={onReload}
      />,
    );
    return { onChanged, onReload, user: userEvent.setup() };
  }

  it("reports the task as done with the version being looked at", async () => {
    const updated = { ...task("o-review", [ME]), version: 2 };
    reviewMock.mockResolvedValue(updated);
    const { onChanged, user } = setup();
    await user.click(screen.getByRole("button", { name: "Report as done" }));
    expect(reviewMock).toHaveBeenCalledWith("r-1", 1, "submit");
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(updated));
  });

  it("lets the creator approve or send back", async () => {
    reviewMock.mockResolvedValue(task("o-done", [ME]));
    const { user } = setup(task("o-review", [ME]), BOSS);
    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(reviewMock).toHaveBeenCalledWith("r-1", 1, "approve");
    expect(screen.getByRole("button", { name: "Send back" })).toBeInTheDocument();
  });

  it("renders nothing when there is nothing to do", () => {
    setup(task("o-done", [ME]));
    expect(screen.queryByRole("region", { name: "Review" })).not.toBeInTheDocument();
  });

  it("shows the refusal of the server", async () => {
    reviewMock.mockRejectedValue(new ApiError("Only a person assigned can do this.", 403));
    const { onChanged, user } = setup();
    await user.click(screen.getByRole("button", { name: "Report as done" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only a person assigned");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("asks to reload after a version conflict", async () => {
    reviewMock.mockRejectedValue(new ApiError("changed", 412));
    const { onReload, user } = setup();
    await user.click(screen.getByRole("button", { name: "Report as done" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Somebody else changed this task");
    expect(screen.getByRole("button", { name: "Report as done" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Reload the latest version" }));
    expect(onReload).toHaveBeenCalled();
  });
});

describe("SubtaskForm", () => {
  function setup(canCreate: boolean, assignees = [ME]) {
    const onCreated = vi.fn();
    render(
      <SubtaskForm
        tableId="t-1"
        fields={FIELDS}
        parent={task("o-doing", assignees)}
        currentUserId={ME}
        canCreate={canCreate}
        onCreated={onCreated}
      />,
    );
    return { onCreated, user: userEvent.setup() };
  }

  it("creates a subtask linked to the parent", async () => {
    const created = makeRecord("r-2", { "f-name": "Banner" });
    createRecordMock.mockResolvedValue(created);
    const { onCreated, user } = setup(false);

    await user.click(screen.getByRole("button", { name: "Add subtask" }));
    await user.type(screen.getByLabelText("Subtask name"), "  Banner ");
    await user.click(screen.getByRole("button", { name: "Create subtask" }));

    expect(createRecordMock).toHaveBeenCalledWith("t-1", {
      "f-parent": ["r-1"],
      "f-name": "Banner",
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
  });

  it("is offered to an editor or to a person assigned to the task, and to nobody else", () => {
    const { unmount } = render(
      <SubtaskForm
        tableId="t-1"
        fields={FIELDS}
        parent={task("o-doing", ["u-2"])}
        currentUserId={ME}
        canCreate={false}
        onCreated={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Add subtask" })).not.toBeInTheDocument();
    unmount();
    setup(true, ["u-2"]); // an editor
    expect(screen.getByRole("button", { name: "Add subtask" })).toBeInTheDocument();
  });

  it("is not offered in a table without a parent column", () => {
    render(
      <SubtaskForm
        tableId="t-1"
        fields={[NAME, ASSIGNEE]}
        parent={task("o-doing", [ME])}
        currentUserId={ME}
        canCreate
        onCreated={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Add subtask" })).not.toBeInTheDocument();
  });

  it("explains a refusal (not a department head)", async () => {
    createRecordMock.mockRejectedValue(new ApiError("You do not have permission.", 403));
    const { onCreated, user } = setup(false);
    await user.click(screen.getByRole("button", { name: "Add subtask" }));
    await user.type(screen.getByLabelText("Subtask name"), "Banner");
    await user.click(screen.getByRole("button", { name: "Create subtask" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("department head");
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("needs a name before it can be created, and can be cancelled", async () => {
    const { user } = setup(false);
    await user.click(screen.getByRole("button", { name: "Add subtask" }));
    expect(screen.getByRole("button", { name: "Create subtask" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Add subtask" })).toBeInTheDocument();
  });
});

const hello: CommentItem = {
  id: "c-1",
  record_id: "r-1",
  author: { id: ME, full_name: "Me Myself" },
  body: "On it.",
  created_at: "2026-11-13T10:00:00Z",
};
const theirs: CommentItem = {
  id: "c-2",
  record_id: "r-1",
  author: { id: BOSS, full_name: "The Boss" },
  body: "Thanks.",
  created_at: "2026-11-13T11:00:00Z",
};

describe("CommentsPanel", () => {
  it("lists the comments and lets me delete only my own", async () => {
    listMock.mockResolvedValue({ items: [hello, theirs], next_cursor: null });
    deleteCommentMock.mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<CommentsPanel recordId="r-1" currentUserId={ME} />);
    const user = userEvent.setup();

    expect(await screen.findByText("On it.")).toBeInTheDocument();
    expect(screen.getByText("Thanks.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Delete comment" })).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Delete comment" }));
    expect(deleteCommentMock).toHaveBeenCalledWith("c-1");
    await waitFor(() => expect(screen.queryByText("On it.")).not.toBeInTheDocument());
    expect(screen.getByText("Thanks.")).toBeInTheDocument();
  });

  it("adds a comment at the end and clears the box", async () => {
    listMock.mockResolvedValue({ items: [theirs], next_cursor: null });
    createCommentMock.mockResolvedValue(hello);
    render(<CommentsPanel recordId="r-1" currentUserId={ME} />);
    const user = userEvent.setup();

    await screen.findByText("Thanks.");
    const send = screen.getByRole("button", { name: "Comment" });
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText("Write a comment"), "  On it.  ");
    await user.click(send);

    expect(createCommentMock).toHaveBeenCalledWith("r-1", "On it.");
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[1]).toHaveTextContent("On it.");
    expect(screen.getByLabelText("Write a comment")).toHaveValue("");
  });

  it("says when there are none and loads more pages", async () => {
    listMock
      .mockResolvedValueOnce({ items: [hello], next_cursor: "next" })
      .mockResolvedValueOnce({ items: [theirs], next_cursor: null });
    render(<CommentsPanel recordId="r-1" currentUserId={ME} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Load more comments" }));
    expect(listMock).toHaveBeenLastCalledWith("r-1", "next");
    expect(await screen.findByText("Thanks.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more comments" })).not.toBeInTheDocument();
  });

  it("shows an empty state", async () => {
    listMock.mockResolvedValue({ items: [], next_cursor: null });
    render(<CommentsPanel recordId="r-1" currentUserId={ME} />);
    expect(await screen.findByText("No comments yet.")).toBeInTheDocument();
  });

  it("tells a read-only person why they cannot write", async () => {
    listMock.mockResolvedValue({ items: [], next_cursor: null });
    createCommentMock.mockRejectedValue(
      new ApiError("You do not have permission to do this.", 403),
    );
    render(<CommentsPanel recordId="r-1" currentUserId={ME} />);
    const user = userEvent.setup();
    await screen.findByText("No comments yet.");
    await user.type(screen.getByLabelText("Write a comment"), "hi");
    await user.click(screen.getByRole("button", { name: "Comment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "read this discussion but not write",
    );
  });

  it("shows an error when the comments cannot be loaded", async () => {
    listMock.mockRejectedValue(new ApiError("You do not have permission to do this.", 403));
    render(<CommentsPanel recordId="r-1" currentUserId={ME} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("do not have permission");
  });
});
