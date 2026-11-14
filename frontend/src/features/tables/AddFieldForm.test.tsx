import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import { AddFieldForm } from "./AddFieldForm";
import { createField, listTables } from "./api";
import { NAME } from "./fixtures";

vi.mock("./api", () => ({ createField: vi.fn(), listTables: vi.fn() }));

const createFieldMock = vi.mocked(createField);
const listTablesMock = vi.mocked(listTables);
const onCreated = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  createFieldMock.mockResolvedValue(NAME);
  listTablesMock.mockResolvedValue([
    { id: "t-1", base_id: "b-1", name: "Tasks" },
    { id: "t-2", base_id: "b-1", name: "Projects" },
  ]);
});

async function fill(name: string, type?: string) {
  const user = userEvent.setup();
  render(<AddFieldForm tableId="t-1" baseId="b-1" onCreated={onCreated} />);
  await user.type(screen.getByLabelText("Column name"), name);
  if (type) await user.selectOptions(screen.getByLabelText("Type"), type);
  return user;
}

describe("adding a column", () => {
  it("makes a plain text column", async () => {
    const user = await fill("Budget");
    await user.click(screen.getByRole("button", { name: "Add column" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(NAME));
    expect(createFieldMock).toHaveBeenCalledWith("t-1", { name: "Budget", type: "text", config: {} });
  });

  it("trims the name and clears the form for the next column", async () => {
    const user = await fill("  Budget  ");
    await user.click(screen.getByRole("button", { name: "Add column" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(createFieldMock.mock.calls[0][1].name).toBe("Budget");
    expect(screen.getByLabelText("Column name")).toHaveValue("");
  });

  it("will not submit without a name", async () => {
    render(<AddFieldForm tableId="t-1" baseId="b-1" onCreated={onCreated} />);
    expect(screen.getByRole("button", { name: "Add column" })).toBeDisabled();
  });

  it("takes the options of a choice column one per line", async () => {
    const user = await fill("Stage", "single_select");
    await user.type(screen.getByLabelText("Options (one per line)"), "Open{Enter}  Closed  {Enter}{Enter}");
    await user.click(screen.getByRole("button", { name: "Add column" }));
    await waitFor(() => expect(createFieldMock).toHaveBeenCalled());
    expect(createFieldMock.mock.calls[0][1].config).toEqual({
      options: [{ name: "Open" }, { name: "Closed" }],
    });
  });

  it("leaves a status column without options to the server's defaults", async () => {
    const user = await fill("State", "status");
    await user.click(screen.getByRole("button", { name: "Add column" }));
    await waitFor(() => expect(createFieldMock).toHaveBeenCalled());
    expect(createFieldMock.mock.calls[0][1]).toMatchObject({ type: "status", config: {} });
  });

  it("sends the decimal places of a number column", async () => {
    const user = await fill("Price", "number");
    await user.clear(screen.getByLabelText("Decimal places"));
    await user.type(screen.getByLabelText("Decimal places"), "2");
    await user.click(screen.getByRole("button", { name: "Add column" }));
    await waitFor(() => expect(createFieldMock).toHaveBeenCalled());
    expect(createFieldMock.mock.calls[0][1].config).toEqual({ precision: 2 });
  });

  it("can include the time in a date column", async () => {
    const user = await fill("Starts", "date");
    await user.click(screen.getByLabelText("Include the time"));
    await user.click(screen.getByRole("button", { name: "Add column" }));
    await waitFor(() => expect(createFieldMock).toHaveBeenCalled());
    expect(createFieldMock.mock.calls[0][1].config).toEqual({ include_time: true });
  });

  it("links to another table of the same base", async () => {
    const user = await fill("Project", "link_record");
    expect(await screen.findByRole("option", { name: "Projects" })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Link to table"), "Projects");
    await user.click(screen.getByRole("button", { name: "Add column" }));
    await waitFor(() => expect(createFieldMock).toHaveBeenCalled());
    expect(createFieldMock.mock.calls[0][1]).toMatchObject({
      type: "link_record",
      config: { table_id: "t-2" },
    });
    expect(listTablesMock).toHaveBeenCalledWith("b-1", expect.any(AbortSignal));
  });
});

describe("when it fails", () => {
  it("shows the server's reason and keeps what was typed", async () => {
    createFieldMock.mockRejectedValue(
      new ApiError("A field with this name already exists in the table.", 409),
    );
    const user = await fill("Name");
    await user.click(screen.getByRole("button", { name: "Add column" }));
    expect(await screen.findByText(/already exists/)).toBeInTheDocument();
    expect(screen.getByLabelText("Column name")).toHaveValue("Name");
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("copes with an unexpected error", async () => {
    createFieldMock.mockRejectedValue(new Error("boom"));
    const user = await fill("Budget");
    await user.click(screen.getByRole("button", { name: "Add column" }));
    expect(await screen.findByText("Could not add the field.")).toBeInTheDocument();
  });

  it("says so when the tables to link to cannot be loaded", async () => {
    listTablesMock.mockRejectedValue(new Error("down"));
    await fill("Project", "link_record");
    expect(await screen.findByText("Could not load the tables of this base.")).toBeInTheDocument();
  });
});

describe("giving a column a role", () => {
  it("offers the assignee role for a people column and sends it", async () => {
    const user = await fill("Owner", "user");
    await user.selectOptions(screen.getByLabelText("Role of this column"), "assignee");
    await user.click(screen.getByRole("button", { name: "Add column" }));
    await waitFor(() => expect(createFieldMock).toHaveBeenCalled());
    expect(createFieldMock.mock.calls[0][1]).toMatchObject({ type: "user", semantic: "assignee" });
  });

  it("sends no role unless one is chosen, and offers none for a text column", async () => {
    const user = await fill("Owner", "user");
    await user.click(screen.getByRole("button", { name: "Add column" }));
    await waitFor(() => expect(createFieldMock).toHaveBeenCalled());
    expect(createFieldMock.mock.calls[0][1]).not.toHaveProperty("semantic");

    await user.selectOptions(screen.getByLabelText("Type"), "text");
    expect(screen.queryByLabelText("Role of this column")).not.toBeInTheDocument();
  });

  it("forgets the role when the type changes", async () => {
    const user = await fill("Due", "user");
    await user.selectOptions(screen.getByLabelText("Role of this column"), "assignee");
    await user.selectOptions(screen.getByLabelText("Type"), "date");
    await user.click(screen.getByRole("button", { name: "Add column" }));
    await waitFor(() => expect(createFieldMock).toHaveBeenCalled());
    expect(createFieldMock.mock.calls[0][1]).not.toHaveProperty("semantic");
  });

  it("disables a role the table already has", async () => {
    const user = userEvent.setup();
    render(
      <AddFieldForm
        tableId="t-1"
        baseId="b-1"
        existing={[{ ...NAME, type: "user", semantic: "assignee" }]}
        onCreated={onCreated}
      />,
    );
    await user.selectOptions(screen.getByLabelText("Type"), "user");
    expect(screen.getByRole("option", { name: /Assignee.*already has one/ })).toBeDisabled();
    expect(screen.getByRole("option", { name: /Follower/ })).toBeEnabled();
  });
});
