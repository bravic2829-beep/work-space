import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import {
  createRecord,
  getRecordViewers,
  lookupUsers,
  searchDirectory,
  updateRecord,
} from "./api";
import { AssignTaskDrawer, assignTargets } from "./AssignTaskDrawer";
import { ASSIGNEE, NAME, makeField, makeRecord } from "./fixtures";
import { RecordViewersPanel } from "./RecordViewersPanel";
import type { FieldItem, RecordViewers } from "./schema";
import { resetUserNames } from "./useUserNames";

vi.mock("./api", () => ({
  createRecord: vi.fn(),
  getRecordViewers: vi.fn(),
  updateRecord: vi.fn(),
  lookupUsers: vi.fn(),
  searchDirectory: vi.fn(),
}));

const createMock = vi.mocked(createRecord);
const viewersMock = vi.mocked(getRecordViewers);
const updateMock = vi.mocked(updateRecord);
const lookupMock = vi.mocked(lookupUsers);
const searchMock = vi.mocked(searchDirectory);

const DUE = makeField("f-due", "Due date", "date", {
  semantic: "due_date",
  config: { include_time: false },
});
const FOLLOWER = makeField("f-follower", "Follower", "user", {
  semantic: "follower",
  config: { multiple: true },
  grants_view: true,
});
const NOTES = makeField("f-notes", "Notes", "long_text");
const FIELDS: FieldItem[] = [NAME, ASSIGNEE, FOLLOWER, DUE, NOTES].map((f, position) => ({
  ...f,
  position,
}));

const ann = { id: "u-ann", employee_code: "A1", full_name: "Ann" };
const binh = { id: "u-binh", employee_code: "B2", full_name: "Binh" };

beforeEach(() => {
  vi.resetAllMocks();
  resetUserNames();
  lookupMock.mockResolvedValue([ann, binh]);
  searchMock.mockResolvedValue([ann, binh]);
});

describe("assignTargets", () => {
  it("finds the columns the form fills", () => {
    const targets = assignTargets(FIELDS);
    expect(targets?.name.id).toBe("f-name");
    expect(targets?.assignee.id).toBe("f-assignee");
    expect(targets?.due?.id).toBe("f-due");
    expect(targets?.follower?.id).toBe("f-follower");
    expect(targets?.description?.id).toBe("f-notes");
  });

  it("is null without an assignee column, or when it cannot be edited", () => {
    expect(assignTargets([NAME])).toBeNull();
    expect(assignTargets(FIELDS.map((f) => ({ ...f, access: "read" as const })))).toBeNull();
  });
});

describe("AssignTaskDrawer", () => {
  function setup() {
    const onAssigned = vi.fn();
    const onClose = vi.fn();
    render(
      <AssignTaskDrawer tableId="t-1" fields={FIELDS} onAssigned={onAssigned} onClose={onClose} />,
    );
    return { onAssigned, onClose, user: userEvent.setup() };
  }

  async function pick(user: ReturnType<typeof userEvent.setup>, label: string, text: string) {
    await user.type(screen.getByLabelText(`Find an employee for ${label}`), "a");
    await user.click(await screen.findByRole("button", { name: `Add ${text}` }));
  }

  it("needs a name and a person before it can be sent", async () => {
    const { user } = setup();
    const send = screen.getByRole("button", { name: "Assign task" });
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText("Task name"), "Prepare the report");
    expect(send).toBeDisabled();
    await pick(user, "Assign to", "Ann (A1)");
    expect(send).toBeEnabled();
  });

  it("creates the task with the person, the due date and who else may see it", async () => {
    const { user, onAssigned, onClose } = setup();
    createMock.mockResolvedValue(makeRecord("r-new", {}));

    await user.type(screen.getByLabelText("Task name"), "  Prepare the report ");
    await pick(user, "Assign to", "Ann (A1)");
    await user.type(screen.getByLabelText("Due date"), "2026-11-20");
    await user.type(screen.getByLabelText("Notes"), "Use the October numbers");
    await pick(user, "Who else can see it", "Binh (B2)");
    await user.click(screen.getByRole("button", { name: "Assign task" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(createMock).toHaveBeenCalledWith("t-1", {
      "f-name": "Prepare the report",
      "f-assignee": ["u-ann"],
      "f-due": "2026-11-20",
      "f-notes": "Use the October numbers",
      "f-follower": ["u-binh"],
    });
    expect(onAssigned).toHaveBeenCalledWith(
      expect.anything(),
      "Prepare the report",
      "Ann (A1)",
    );
  });

  it("sends only what was filled in", async () => {
    const { user } = setup();
    createMock.mockResolvedValue(makeRecord("r-new", {}));
    await user.type(screen.getByLabelText("Task name"), "Quick one");
    await pick(user, "Assign to", "Ann (A1)");
    await user.click(screen.getByRole("button", { name: "Assign task" }));
    await waitFor(() => expect(createMock).toHaveBeenCalled());
    expect(createMock).toHaveBeenCalledWith("t-1", {
      "f-name": "Quick one",
      "f-assignee": ["u-ann"],
    });
  });

  it("gives one task to several people and says so", async () => {
    const { user, onAssigned } = setup();
    createMock.mockResolvedValue(makeRecord("r-new", {}));
    await user.type(screen.getByLabelText("Task name"), "Count the stock");
    await pick(user, "Assign to", "Ann (A1)");
    await pick(user, "Assign to", "Binh (B2)");
    await user.click(screen.getByRole("button", { name: "Assign task" }));

    await waitFor(() => expect(onAssigned).toHaveBeenCalled());
    expect(createMock).toHaveBeenCalledWith("t-1", {
      "f-name": "Count the stock",
      "f-assignee": ["u-ann", "u-binh"],
    });
    expect(onAssigned).toHaveBeenCalledWith(
      expect.anything(),
      "Count the stock",
      "Ann (A1), Binh (B2)",
    );
  });

  it("shows who will have access before the task is sent", async () => {
    const { user } = setup();
    expect(screen.queryByRole("region", { name: "Who will have access" })).not.toBeInTheDocument();
    await pick(user, "Assign to", "Ann (A1)");
    await pick(user, "Who else can see it", "Binh (B2)");

    const access = screen.getByRole("region", { name: "Who will have access" });
    const rows = within(access).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Ann (A1)");
    expect(rows[0]).toHaveTextContent("Assignee");
    expect(rows[1]).toHaveTextContent("Binh (B2)");
    expect(rows[1]).toHaveTextContent("Can view");
  });

  it("lists a person who is both assignee and viewer once, as the assignee", async () => {
    const { user } = setup();
    await pick(user, "Assign to", "Ann (A1)");
    await pick(user, "Who else can see it", "Ann (A1)");
    const access = screen.getByRole("region", { name: "Who will have access" });
    expect(within(access).getAllByRole("listitem")).toHaveLength(1);
    expect(within(access).queryByText("Can view")).not.toBeInTheDocument();
  });

  it("stays open and keeps the person for the next task when asked", async () => {
    const { user, onClose, onAssigned } = setup();
    createMock.mockResolvedValue(makeRecord("r-new", {}));
    await user.click(screen.getByLabelText("Assign another"));
    await user.type(screen.getByLabelText("Task name"), "First");
    await pick(user, "Assign to", "Ann (A1)");
    await user.click(screen.getByRole("button", { name: "Assign task" }));

    await waitFor(() => expect(onAssigned).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Task name")).toHaveValue("");
    const chosen = screen.getByRole("list", { name: "Assign to: chosen" });
    expect(within(chosen).getByText("Ann (A1)")).toBeInTheDocument();
  });

  it("shows the reason when the server refuses and keeps what was typed", async () => {
    const { user, onClose } = setup();
    createMock.mockRejectedValue(new ApiError("You do not have permission to do this.", 403));
    await user.type(screen.getByLabelText("Task name"), "Nope");
    await pick(user, "Assign to", "Ann (A1)");
    await user.click(screen.getByRole("button", { name: "Assign task" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("You do not have permission");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Task name")).toHaveValue("Nope");
  });
});

const VIEWERS: RecordViewers = {
  workspace_name: "Operations",
  workspace_member_count: 7,
  people: [
    {
      user_id: "u-boss",
      full_name: "Boss",
      employee_code: "B0",
      reasons: ["creator"],
      field_names: [],
    },
    {
      user_id: "u-ann",
      full_name: "Ann",
      employee_code: "A1",
      reasons: ["assignee"],
      field_names: ["Assignee"],
    },
    {
      user_id: "u-binh",
      full_name: "Binh",
      employee_code: "B2",
      reasons: ["follower"],
      field_names: ["Follower"],
    },
  ],
};

describe("RecordViewersPanel", () => {
  const record = makeRecord("r-1", { "f-follower": ["u-binh"] }, { version: 3 });

  function setup(fields: FieldItem[] = FIELDS) {
    const onChanged = vi.fn();
    render(<RecordViewersPanel fields={fields} record={record} onChanged={onChanged} />);
    return { onChanged, user: userEvent.setup() };
  }

  it("lists who sees the task and why, and says the workspace sees it too", async () => {
    viewersMock.mockResolvedValue(VIEWERS);
    setup();
    const list = await screen.findByRole("list", { name: "People who can see this task" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByText("Boss")).toBeInTheDocument();
    expect(within(items[0]).getByText("Created it")).toBeInTheDocument();
    expect(within(items[1]).getByText("Assigned")).toBeInTheDocument();
    expect(within(items[2]).getByText("Can view")).toBeInTheDocument();
    expect(screen.getByText(/Everyone in “Operations” \(7 people\)/)).toBeInTheDocument();
    expect(viewersMock).toHaveBeenCalledWith("r-1", expect.any(AbortSignal));
  });

  it("takes access away from a follower, but not from the assignee or the creator", async () => {
    viewersMock.mockResolvedValue(VIEWERS);
    updateMock.mockResolvedValue(makeRecord("r-1", {}, { version: 4 }));
    const { user, onChanged } = setup();
    await screen.findByText("Boss");
    expect(screen.queryByRole("button", { name: /Stop Boss/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Stop Ann/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Stop Binh from seeing this task" }));

    expect(updateMock).toHaveBeenCalledWith("r-1", 3, { "f-follower": [] });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("lets one more person see the task, keeping the followers already there", async () => {
    viewersMock.mockResolvedValue(VIEWERS);
    updateMock.mockResolvedValue(makeRecord("r-1", {}, { version: 4 }));
    const { user } = setup();
    await screen.findByText("Boss");

    await user.type(screen.getByLabelText("Find an employee for Let someone see this task"), "a");
    await user.click(await screen.findByRole("button", { name: "Add Ann (A1)" }));

    expect(updateMock).toHaveBeenCalledWith("r-1", 3, { "f-follower": ["u-binh", "u-ann"] });
  });

  it("only shows the list when the person cannot edit the Follower column", async () => {
    viewersMock.mockResolvedValue(VIEWERS);
    setup(FIELDS.map((f) => (f.id === "f-follower" ? { ...f, access: "read" as const } : f)));
    await screen.findByText("Boss");
    expect(screen.queryByText("Let someone else see it")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Stop Binh/ })).not.toBeInTheDocument();
  });

  it("explains a conflict instead of overwriting somebody else's change", async () => {
    viewersMock.mockResolvedValue(VIEWERS);
    updateMock.mockRejectedValue(new ApiError("Precondition failed", 412));
    const { user } = setup();
    await screen.findByText("Boss");
    await user.click(screen.getByRole("button", { name: "Stop Binh from seeing this task" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Somebody else changed this task");
  });

  it("says so when the list cannot be loaded", async () => {
    viewersMock.mockRejectedValue(new ApiError("Boom", 500));
    setup();
    expect(await screen.findByText("Could not load who can see this task.")).toBeInTheDocument();
  });
});
