import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import { createRecord, deleteRecord, getRecordViewers, lookupUsers, updateRecord } from "./api";
import { DUE, FIELDS, NAME, POINTS, makeField, makeRecord } from "./fixtures";
import { RecordSidebar } from "./RecordSidebar";
import { resetUserNames } from "./useUserNames";

vi.mock("./api", () => ({
  createRecord: vi.fn(),
  deleteRecord: vi.fn(),
  updateRecord: vi.fn(),
  lookupUsers: vi.fn(),
  searchDirectory: vi.fn(),
  getTable: vi.fn(),
  listRecords: vi.fn(),
  getRecordViewers: vi.fn(),
}));

const createRecordMock = vi.mocked(createRecord);
const deleteRecordMock = vi.mocked(deleteRecord);
const updateRecordMock = vi.mocked(updateRecord);
const lookupUsersMock = vi.mocked(lookupUsers);

const record = makeRecord("r-1", { "f-name": "Plan", "f-points": 5, "f-assignee": ["u-2"] });

const handlers = {
  onSaved: vi.fn(),
  onDeleted: vi.fn(),
  onReload: vi.fn(),
  onClose: vi.fn(),
};

function renderSidebar(
  overrides: Partial<React.ComponentProps<typeof RecordSidebar>> = {},
) {
  return render(
    <RecordSidebar
      tableId="t-1"
      fields={FIELDS}
      record={record}
      currentUserId="u-me"
      canCreate
      {...handlers}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  resetUserNames();
  lookupUsersMock.mockResolvedValue([{ id: "u-2", employee_code: "E2", full_name: "Binh" }]);
  vi.mocked(getRecordViewers).mockResolvedValue({
    people: [],
    workspace_name: "Workspace",
    workspace_member_count: 1,
  });
});

describe("adding a task on somebody's sheet", () => {
  it("leaves out the people columns and says who gets the task", () => {
    renderSidebar({ record: null, givenTo: "Nguyen Van An" });
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.queryByText("Assignee")).not.toBeInTheDocument();
    expect(screen.getByText("Nguyen Van An")).toBeInTheDocument();
    expect(screen.getByText(/This task will be given to/)).toBeInTheDocument();
  });

  it("still shows every column when the task is not for a sheet owner", () => {
    renderSidebar({ record: null });
    expect(screen.getByText("Assignee")).toBeInTheDocument();
    expect(screen.queryByText(/This task will be given to/)).not.toBeInTheDocument();
  });
});

describe("showing a record", () => {
  it("lists every column with its value and resolves the names of people", async () => {
    renderSidebar();
    expect(screen.getByLabelText("Name")).toHaveValue("Plan");
    expect(screen.getByLabelText("Points")).toHaveValue(5);
    expect(await screen.findByText("Binh (E2)")).toBeInTheDocument();
    expect(lookupUsersMock).toHaveBeenCalledWith(["u-2"]);
  });

  it("shows a computed column as text, without an input", () => {
    renderSidebar();
    expect(screen.queryByRole("textbox", { name: "Created time" })).not.toBeInTheDocument();
    expect(screen.getByText("Created time")).toBeInTheDocument();
  });
});

describe("saving", () => {
  it("sends only the cells that changed, with the version being edited", async () => {
    const user = userEvent.setup();
    const saved = { ...record, version: 2, data: { ...record.data, "f-name": "Final" } };
    updateRecordMock.mockResolvedValue(saved);
    renderSidebar();

    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled(); // nothing changed yet
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Final");
    await user.click(save);

    await waitFor(() => expect(updateRecordMock).toHaveBeenCalledTimes(1));
    expect(updateRecordMock).toHaveBeenCalledWith("r-1", 1, { "f-name": "Final" });
    expect(handlers.onSaved).toHaveBeenCalledWith(saved, false);
  });

  it("sends an emptied cell as null", async () => {
    const user = userEvent.setup();
    updateRecordMock.mockResolvedValue({ ...record, version: 2 });
    renderSidebar();
    await user.clear(screen.getByLabelText("Points"));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateRecordMock).toHaveBeenCalled());
    expect(updateRecordMock).toHaveBeenCalledWith("r-1", 1, { "f-points": null });
  });

  it("ignores text typed into a number box, so there is nothing to save", async () => {
    const user = userEvent.setup();
    renderSidebar({ record: makeRecord("r-1", { "f-name": "Plan" }) });
    await user.type(screen.getByLabelText("Points"), "lots");
    // The browser refuses letters in a number input, so the cell stays empty and unchanged.
    expect(screen.getByLabelText("Points")).toHaveValue(null);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(updateRecordMock).not.toHaveBeenCalled();
  });

  it("explains a conflict and offers to reload instead of overwriting", async () => {
    const user = userEvent.setup();
    updateRecordMock.mockRejectedValue(new ApiError("The record was changed.", 412));
    renderSidebar();
    await user.type(screen.getByLabelText("Name"), "!");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText(/Somebody else changed this record/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reload the latest version" }));
    expect(handlers.onReload).toHaveBeenCalled();
    expect(handlers.onSaved).not.toHaveBeenCalled();
  });

  it("shows the server's message under the column it is about", async () => {
    const user = userEvent.setup();
    updateRecordMock.mockRejectedValue(
      new ApiError("One or more values are invalid.", 422, [
        { field: "f-points", message: "Must be a reasonable number." },
      ]),
    );
    renderSidebar();
    await user.type(screen.getByLabelText("Points"), "0");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    const message = await screen.findByText("Must be a reasonable number.");
    expect(screen.getByLabelText("Points")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Points")).toHaveAccessibleDescription(message.textContent ?? "");
  });

  it("shows a refusal", async () => {
    const user = userEvent.setup();
    updateRecordMock.mockRejectedValue(new ApiError("You cannot edit the column 'Name'.", 403));
    renderSidebar();
    await user.type(screen.getByLabelText("Name"), "!");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("You cannot edit the column 'Name'.")).toBeInTheDocument();
  });

  it("copes with a network failure", async () => {
    const user = userEvent.setup();
    updateRecordMock.mockRejectedValue(new Error("boom"));
    renderSidebar();
    await user.type(screen.getByLabelText("Name"), "!");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Could not save the record.")).toBeInTheDocument();
  });
});

describe("read-only", () => {
  it("disables the columns without edit access and hides the save button", () => {
    const readOnly = FIELDS.map((field) => ({ ...field, access: "read" as const }));
    renderSidebar({ fields: readOnly });
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(screen.getByText("You can read this record but not change it.")).toBeInTheDocument();
  });

  it("lets somebody edit just the one column they were given", () => {
    const fields = FIELDS.map((field) =>
      field.id === POINTS.id ? field : { ...field, access: "read" as const },
    );
    renderSidebar({ fields });
    expect(screen.getByLabelText("Points")).toBeEnabled();
    expect(screen.getByLabelText("Name")).toBeDisabled();
  });
});

describe("a new record", () => {
  it("sends only the cells that were filled", async () => {
    const user = userEvent.setup();
    const created = makeRecord("r-new", { "f-name": "New" });
    createRecordMock.mockResolvedValue(created);
    renderSidebar({ record: null });

    expect(screen.getByRole("heading", { name: "New record" })).toBeInTheDocument();
    expect(screen.queryByText("Created time")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete record" })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Name"), "New");
    await user.click(screen.getByRole("button", { name: "Create record" }));

    await waitFor(() => expect(createRecordMock).toHaveBeenCalledTimes(1));
    expect(createRecordMock).toHaveBeenCalledWith("t-1", { "f-name": "New" });
    expect(handlers.onSaved).toHaveBeenCalledWith(created, true);
  });

  it("is refused to people who cannot add records", () => {
    renderSidebar({ record: null, canCreate: false });
    expect(screen.getByText(/do not have permission to add records/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });

  it("reports a missing required value from the server", async () => {
    const user = userEvent.setup();
    createRecordMock.mockRejectedValue(
      new ApiError("One or more values are invalid.", 422, [
        { field: NAME.id, message: "This field is required." },
      ]),
    );
    renderSidebar({ record: null });
    await user.type(screen.getByLabelText("Points"), "3");
    await user.click(screen.getByRole("button", { name: "Create record" }));
    expect(await screen.findByText("This field is required.")).toBeInTheDocument();
  });
});

describe("deleting", () => {
  it("is offered to the person who created the record only", () => {
    renderSidebar({ currentUserId: "u-me" });
    expect(screen.getByRole("button", { name: "Delete record" })).toBeInTheDocument();
  });

  it("is not offered to anybody else", () => {
    renderSidebar({ currentUserId: "u-someone-else" });
    expect(screen.queryByRole("button", { name: "Delete record" })).not.toBeInTheDocument();
  });

  it("asks first, and does nothing when the person says no", async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole("button", { name: "Delete record" }));
    expect(screen.getByText("Delete this record for good?")).toBeInTheDocument();
    expect(deleteRecordMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(deleteRecordMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Delete record" })).toBeInTheDocument();
  });

  it("deletes the record for good after a yes", async () => {
    const user = userEvent.setup();
    deleteRecordMock.mockResolvedValue(undefined);
    renderSidebar();
    await user.click(screen.getByRole("button", { name: "Delete record" }));
    await user.click(screen.getByRole("button", { name: "Yes, delete" }));
    await waitFor(() => expect(handlers.onDeleted).toHaveBeenCalledWith("r-1"));
    expect(deleteRecordMock).toHaveBeenCalledWith("r-1");
  });

  it("shows the reason when the server refuses", async () => {
    const user = userEvent.setup();
    deleteRecordMock.mockRejectedValue(
      new ApiError("Only the person who created a record can delete it.", 403),
    );
    renderSidebar();
    await user.click(screen.getByRole("button", { name: "Delete record" }));
    await user.click(screen.getByRole("button", { name: "Yes, delete" }));
    expect(await screen.findByText(/Only the person who created/)).toBeInTheDocument();
    expect(handlers.onDeleted).not.toHaveBeenCalled();
  });
});

describe("a new record", () => {
  const auto = makeField("f-d", "Created on", "date", {
    config: { include_time: false, fill: "created" },
  });

  it("starts with today's date in a column filled automatically, and saves it", async () => {
    const user = userEvent.setup();
    createRecordMock.mockResolvedValue(record);
    renderSidebar({ record: null, fields: [FIELDS[0], auto] });
    const input = screen.getByLabelText("Created on") as HTMLInputElement;
    expect(input.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const shown = input.value;

    await user.type(screen.getByLabelText("Name"), "Launch");
    await user.click(screen.getByRole("button", { name: "Create record" }));
    await waitFor(() => expect(createRecordMock).toHaveBeenCalled());
    expect(createRecordMock.mock.calls[0][1]).toMatchObject({ "f-d": shown });
  });

  it("lets the person pick another date", async () => {
    const user = userEvent.setup();
    createRecordMock.mockResolvedValue(record);
    renderSidebar({ record: null, fields: [FIELDS[0], auto] });
    const input = screen.getByLabelText("Created on");
    await user.clear(input);
    await user.type(input, "2026-01-02");
    await user.type(screen.getByLabelText("Name"), "Launch");
    await user.click(screen.getByRole("button", { name: "Create record" }));
    await waitFor(() => expect(createRecordMock).toHaveBeenCalled());
    expect(createRecordMock.mock.calls[0][1]).toMatchObject({ "f-d": "2026-01-02" });
  });

  it("leaves a date picked by hand empty", () => {
    renderSidebar({ record: null, fields: [FIELDS[0], DUE] });
    expect(screen.getByLabelText("Due date")).toHaveValue("");
  });
});

describe("closing", () => {
  it("calls onClose", async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole("button", { name: "Close panel" }));
    expect(handlers.onClose).toHaveBeenCalled();
  });
});
