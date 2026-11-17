import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import { getTableAccess, lookupUsers, searchDirectory, setPersonAccess } from "./api";
import { ColumnAccessDrawer } from "./ColumnAccessDrawer";
import { FIELDS } from "./fixtures";
import type { PersonAccess } from "./schema";
import { resetUserNames } from "./useUserNames";

vi.mock("./api", () => ({
  getTableAccess: vi.fn(),
  setPersonAccess: vi.fn(),
  lookupUsers: vi.fn(),
  searchDirectory: vi.fn(),
}));

const ann = { id: "u-ann", employee_code: "A1", full_name: "Ann" };
const binh = { id: "u-binh", employee_code: "B2", full_name: "Binh" };

// FIELDS: Name, Points, Done, Priority, Tags, Due date, Assignee, Created time (ids f-name ...).
const POINTS = "f-points";
const DUE = "f-due";

beforeEach(() => {
  vi.resetAllMocks();
  resetUserNames();
  vi.mocked(lookupUsers).mockResolvedValue([ann, binh]);
  vi.mocked(searchDirectory).mockResolvedValue([ann, binh]);
  vi.mocked(getTableAccess).mockResolvedValue([]);
});

async function open(existing: PersonAccess[] = []) {
  vi.mocked(getTableAccess).mockResolvedValue(existing);
  render(<ColumnAccessDrawer tableId="t-1" fields={FIELDS} onClose={vi.fn()} />);
  await screen.findByRole("region", { name: "Person" });
  return userEvent.setup();
}

async function choosePerson(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Find an employee for Person"), "a");
  await user.click(await screen.findByRole("button", { name: "Add Ann (A1)" }));
}

describe("ColumnAccessDrawer", () => {
  it("shows every column of the table once a person is chosen, all as their role allows", async () => {
    const user = await open();
    expect(screen.queryByRole("region", { name: "Columns" })).not.toBeInTheDocument();
    await choosePerson(user);
    const list = await screen.findByRole("list", { name: "Columns of the table" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(FIELDS.length);
    for (const field of FIELDS) {
      expect(screen.getByLabelText(`Access to ${field.name}`)).toHaveValue("default");
    }
    expect(screen.getByRole("button", { name: "Save access" })).toBeDisabled();
    expect(screen.getByText("Nothing is hidden from this person.")).toBeInTheDocument();
  });

  it("saves only what was changed, and sends null to go back to the default", async () => {
    vi.mocked(setPersonAccess).mockResolvedValue({
      user_id: "u-ann",
      rules: [
        { field_id: POINTS, access: "hidden" },
        { field_id: DUE, access: "read" },
      ],
    });
    const user = await open([
      { user_id: "u-ann", rules: [{ field_id: "f-done", access: "hidden" }] },
    ]);
    // Ann already has a rule: she is listed, and choosing her loads it.
    await user.click(await screen.findByRole("button", { name: /Ann/ }));
    expect(screen.getByLabelText("Access to Done")).toHaveValue("hidden");

    await user.selectOptions(screen.getByLabelText("Access to Points"), "hidden");
    await user.selectOptions(screen.getByLabelText("Access to Due date"), "read");
    await user.selectOptions(screen.getByLabelText("Access to Done"), "default");
    await user.click(screen.getByRole("button", { name: "Save access" }));

    await waitFor(() => expect(setPersonAccess).toHaveBeenCalled());
    expect(setPersonAccess).toHaveBeenCalledWith("t-1", "u-ann", {
      [POINTS]: "hidden",
      [DUE]: "read",
      "f-done": null,
    });
    expect(await screen.findByText(/^Saved\./)).toBeInTheDocument();
  });

  it("counts what is hidden and says where it disappears", async () => {
    const user = await open();
    await choosePerson(user);
    await user.selectOptions(await screen.findByLabelText("Access to Points"), "hidden");
    expect(
      screen.getByText(/1 of 8 columns are hidden from this person.*history.*reports.*files/),
    ).toBeInTheDocument();
  });

  it("has quick choices for the whole table", async () => {
    const user = await open();
    await choosePerson(user);
    await user.click(await screen.findByRole("button", { name: "Hide all but the first column" }));
    expect(screen.getByLabelText("Access to Name")).toHaveValue("default");
    expect(screen.getByLabelText("Access to Points")).toHaveValue("hidden");
    await user.click(screen.getByRole("button", { name: "Read only everywhere" }));
    expect(screen.getByLabelText("Access to Name")).toHaveValue("read");
    await user.click(screen.getByRole("button", { name: "Reset all" }));
    expect(screen.getByLabelText("Access to Points")).toHaveValue("default");
    expect(screen.getByRole("button", { name: "Save access" })).toBeDisabled();
  });

  it("shows why the server refused and keeps the choices", async () => {
    vi.mocked(setPersonAccess).mockRejectedValue(new ApiError("Unknown column.", 422));
    const user = await open();
    await choosePerson(user);
    await user.selectOptions(await screen.findByLabelText("Access to Points"), "hidden");
    await user.click(screen.getByRole("button", { name: "Save access" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unknown column.");
    expect(screen.getByLabelText("Access to Points")).toHaveValue("hidden");
  });

  it("tells somebody who is not an admin of the workspace, instead of failing silently", async () => {
    vi.mocked(getTableAccess).mockRejectedValue(new ApiError("Forbidden", 403));
    render(<ColumnAccessDrawer tableId="t-1" fields={FIELDS} onClose={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Only the admins of this workspace");
    expect(screen.queryByRole("region", { name: "Person" })).not.toBeInTheDocument();
  });
});
