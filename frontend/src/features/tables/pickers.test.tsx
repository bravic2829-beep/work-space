import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getTable, listRecords, lookupUsers, searchDirectory } from "./api";
import { NAME, makeField, makeRecord, makeTable } from "./fixtures";
import { LinkPicker } from "./LinkPicker";
import { UserPicker } from "./UserPicker";
import { resetUserNames } from "./useUserNames";

vi.mock("./api", () => ({
  searchDirectory: vi.fn(),
  lookupUsers: vi.fn(),
  getTable: vi.fn(),
  listRecords: vi.fn(),
}));

const searchMock = vi.mocked(searchDirectory);
const lookupMock = vi.mocked(lookupUsers);
const getTableMock = vi.mocked(getTable);
const listRecordsMock = vi.mocked(listRecords);

const ann = { id: "u-1", employee_code: "A1", full_name: "Ann" };
const binh = { id: "u-2", employee_code: "B2", full_name: "Binh" };

beforeEach(() => {
  vi.resetAllMocks();
  resetUserNames();
  lookupMock.mockResolvedValue([ann, binh]);
  searchMock.mockResolvedValue([ann, binh]);
});

describe("UserPicker", () => {
  function setup(value: string[] = [], multiple = true, disabled = false) {
    const onChange = vi.fn();
    render(
      <UserPicker label="Assignee" value={value} onChange={onChange} multiple={multiple} disabled={disabled} />,
    );
    return { onChange, user: userEvent.setup() };
  }

  it("finds a colleague by name and adds them", async () => {
    const { onChange, user } = setup();
    await user.type(screen.getByLabelText("Find an employee for Assignee"), "an");
    await user.click(await screen.findByRole("button", { name: "Add Ann (A1)" }));
    expect(searchMock).toHaveBeenCalledWith("an", expect.any(AbortSignal));
    expect(onChange).toHaveBeenCalledWith(["u-1"]);
  });

  it("keeps the people already chosen when adding another", async () => {
    const { onChange, user } = setup(["u-1"]);
    await user.type(screen.getByLabelText("Find an employee for Assignee"), "b");
    await user.click(await screen.findByRole("button", { name: "Add Binh (B2)" }));
    expect(onChange).toHaveBeenCalledWith(["u-1", "u-2"]);
  });

  it("does not offer somebody who is already chosen", async () => {
    const { user } = setup(["u-1"]);
    await user.type(screen.getByLabelText("Find an employee for Assignee"), "a");
    await screen.findByRole("button", { name: "Add Binh (B2)" });
    expect(screen.queryByRole("button", { name: "Add Ann (A1)" })).not.toBeInTheDocument();
  });

  it("replaces the person when only one is allowed", async () => {
    const { onChange, user } = setup(["u-1"], false);
    await user.type(screen.getByLabelText("Find an employee for Assignee"), "b");
    await user.click(await screen.findByRole("button", { name: "Add Binh (B2)" }));
    expect(onChange).toHaveBeenCalledWith(["u-2"]);
  });

  it("shows the names of the chosen people and lets one be removed", async () => {
    const { onChange, user } = setup(["u-1", "u-2"]);
    expect(await screen.findByText("Ann (A1)")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove Ann (A1)" }));
    expect(onChange).toHaveBeenCalledWith(["u-2"]);
  });

  it("is read-only when disabled", async () => {
    setup(["u-1"], true, true);
    expect(await screen.findByText("Ann (A1)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Find an employee for Assignee")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
  });

  it("does not search for an empty box", async () => {
    const { user } = setup();
    const box = screen.getByLabelText("Find an employee for Assignee");
    await user.type(box, "a");
    await screen.findByRole("button", { name: "Add Ann (A1)" });
    searchMock.mockClear();
    await user.clear(box);
    await waitFor(() => expect(screen.queryByRole("button", { name: /Add / })).not.toBeInTheDocument());
    expect(searchMock).not.toHaveBeenCalled();
  });
});

describe("LinkPicker", () => {
  const link = makeField("f-project", "Project", "link_record", {
    config: { table_id: "t-2", multiple: true },
  });
  const projects = makeTable("editor", [{ ...NAME, id: "p-name", table_id: "t-2" }]);

  beforeEach(() => {
    getTableMock.mockResolvedValue({ ...projects, id: "t-2" });
    listRecordsMock.mockResolvedValue({
      items: [makeRecord("p-1", { "p-name": "Website" }), makeRecord("p-2", {})],
      next_cursor: null,
    });
  });

  it("lists the records of the linked table by their first column", async () => {
    render(<LinkPicker field={link} value={["p-1"]} onChange={vi.fn()} />);
    expect(await screen.findByLabelText("Website")).toBeChecked();
    expect(screen.getByLabelText("(untitled)")).not.toBeChecked();
    expect(getTableMock).toHaveBeenCalledWith("t-2", expect.any(AbortSignal));
  });

  it("adds and removes links", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<LinkPicker field={link} value={["p-1"]} onChange={onChange} />);
    await user.click(await screen.findByLabelText("(untitled)"));
    expect(onChange).toHaveBeenLastCalledWith(["p-1", "p-2"]);
    await user.click(screen.getByLabelText("Website"));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("allows one record when the field takes only one", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const single = { ...link, config: { table_id: "t-2", multiple: false } };
    render(<LinkPicker field={single} value={[]} onChange={onChange} />);
    await user.click(await screen.findByLabelText("Website"));
    expect(onChange).toHaveBeenLastCalledWith(["p-1"]);
  });

  it("keeps a link to a record that is not in the first page", async () => {
    render(<LinkPicker field={link} value={["p-9"]} onChange={vi.fn()} />);
    expect(await screen.findByLabelText("Linked record")).toBeChecked();
  });

  it("says when there is more than it lists", async () => {
    listRecordsMock.mockResolvedValue({ items: [], next_cursor: "more" });
    render(<LinkPicker field={link} value={[]} onChange={vi.fn()} />);
    expect(await screen.findByText("Only the first 100 records are listed.")).toBeInTheDocument();
  });

  it("is read-only when disabled", async () => {
    render(<LinkPicker field={link} value={["p-1"]} onChange={vi.fn()} disabled />);
    expect(await screen.findByLabelText("Website")).toBeDisabled();
  });

  it("explains a failure to load", async () => {
    getTableMock.mockRejectedValue(new Error("down"));
    render(<LinkPicker field={link} value={[]} onChange={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the records");
  });

  it("copes with a field that links nowhere", () => {
    render(<LinkPicker field={{ ...link, config: {} }} value={[]} onChange={vi.fn()} />);
    expect(screen.getByText("This link field is not set up.")).toBeInTheDocument();
    expect(getTableMock).not.toHaveBeenCalled();
  });
});
