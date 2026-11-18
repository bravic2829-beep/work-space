import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import {
  addMember,
  changeMemberRole,
  deleteField,
  listMembers,
  removeMember,
  searchDirectory,
  updateField,
} from "./api";
import { makeField, PRIORITY } from "./fixtures";
import { ManageFieldsPanel } from "./ManageFieldsPanel";
import { MembersPanel } from "./MembersPanel";

vi.mock("./api", () => ({
  updateField: vi.fn(),
  deleteField: vi.fn(),
  listMembers: vi.fn(),
  addMember: vi.fn(),
  changeMemberRole: vi.fn(),
  removeMember: vi.fn(),
  searchDirectory: vi.fn(),
  listTables: vi.fn(),
}));

const updateFieldMock = vi.mocked(updateField);
const deleteFieldMock = vi.mocked(deleteField);
const listMembersMock = vi.mocked(listMembers);
const addMemberMock = vi.mocked(addMember);
const changeMemberRoleMock = vi.mocked(changeMemberRole);
const removeMemberMock = vi.mocked(removeMember);
const searchDirectoryMock = vi.mocked(searchDirectory);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("ManageFieldsPanel", () => {
  const text = makeField("f-1", "Name", "text");

  it("renames a column", async () => {
    updateFieldMock.mockResolvedValue({ ...text, name: "Title" });
    const onChanged = vi.fn();
    render(<ManageFieldsPanel fields={[text]} onChanged={onChanged} />);
    const input = screen.getByLabelText("Name of Name");
    await userEvent.clear(input);
    await userEvent.type(input, "Title");
    await userEvent.click(screen.getByRole("button", { name: "Rename Name" }));
    await waitFor(() => expect(updateFieldMock).toHaveBeenCalledWith("f-1", { name: "Title" }));
    expect(onChanged).toHaveBeenCalled();
  });

  it("does not offer Rename until the name changed", () => {
    render(<ManageFieldsPanel fields={[text]} onChanged={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Rename Name" })).toBeDisabled();
  });

  it("shows the server's message when the name is taken", async () => {
    updateFieldMock.mockRejectedValue(new ApiError("A field with this name exists.", 409));
    const onChanged = vi.fn();
    render(<ManageFieldsPanel fields={[text]} onChanged={onChanged} />);
    await userEvent.type(screen.getByLabelText("Name of Name"), "2");
    await userEvent.click(screen.getByRole("button", { name: "Rename Name" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A field with this name exists.");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("keeps the option ids when renaming and adding options", async () => {
    updateFieldMock.mockResolvedValue(PRIORITY);
    render(<ManageFieldsPanel fields={[PRIORITY]} onChanged={vi.fn()} />);
    const first = screen.getByLabelText("Option 1 of Priority");
    await userEvent.clear(first);
    await userEvent.type(first, "Urgent");
    await userEvent.type(screen.getByLabelText("New option for Priority"), "Medium");
    await userEvent.click(screen.getByRole("button", { name: "Add option" }));
    await userEvent.click(screen.getByRole("button", { name: "Save options of Priority" }));
    await waitFor(() =>
      expect(updateFieldMock).toHaveBeenCalledWith("f-priority", {
        config: {
          options: [
            { id: "o-high", name: "Urgent" },
            { id: "o-low", name: "Low" },
            { name: "Medium" },
          ],
        },
      }),
    );
  });

  it("shows the refusal when an option still in use is removed", async () => {
    updateFieldMock.mockRejectedValue(new ApiError("The option High is used by 3 record(s).", 409));
    render(<ManageFieldsPanel fields={[PRIORITY]} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove option High from Priority" }));
    await userEvent.click(screen.getByRole("button", { name: "Save options of Priority" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("used by 3");
  });

  it("converts the type", async () => {
    updateFieldMock.mockResolvedValue({ ...text, type: "long_text" });
    render(<ManageFieldsPanel fields={[text]} onChanged={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText("Type of Name"), "long_text");
    await userEvent.click(screen.getByRole("button", { name: "Convert Name" }));
    await waitFor(() =>
      expect(updateFieldMock).toHaveBeenCalledWith("f-1", { type: "long_text" }),
    );
  });

  it("does not let a column with a role change its type", () => {
    const assignee = makeField("f-a", "Assignee", "user", {
      semantic: "assignee",
      grants_view: true,
    });
    render(<ManageFieldsPanel fields={[assignee]} onChanged={vi.fn()} />);
    expect(screen.queryByLabelText("Type of Assignee")).not.toBeInTheDocument();
  });

  it("asks before deleting a column", async () => {
    deleteFieldMock.mockResolvedValue(undefined);
    const onChanged = vi.fn();
    render(<ManageFieldsPanel fields={[text]} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete Name" }));
    expect(deleteFieldMock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Confirm delete Name" }));
    await waitFor(() => expect(deleteFieldMock).toHaveBeenCalledWith("f-1"));
    expect(onChanged).toHaveBeenCalled();
  });

  it("can cancel a deletion", async () => {
    render(<ManageFieldsPanel fields={[text]} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete Name" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(deleteFieldMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Delete Name" })).toBeInTheDocument();
  });
});

describe("MembersPanel", () => {
  const ann = {
    user_id: "u-1",
    employee_code: "E1",
    full_name: "Ann",
    role: "admin" as const,
    is_org_admin: false,
  };
  const bob = {
    user_id: "u-2",
    employee_code: "E2",
    full_name: "Bob",
    role: "viewer" as const,
    is_org_admin: false,
  };

  it("shows an organization admin as having full access, with no role to change or leave", async () => {
    const boss = { ...bob, user_id: "u-7", full_name: "Boss", is_org_admin: true };
    listMembersMock.mockResolvedValue([boss, bob]);
    render(<MembersPanel workspaceId="w-1" canManage currentUserId="u-7" />);
    expect(await screen.findByText("Org admin · full access")).toBeInTheDocument();
    expect(screen.queryByLabelText("Role of Boss")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Boss" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Role of Bob")).toBeInTheDocument();
  });

  it("lists the members read-only for someone who cannot manage", async () => {
    listMembersMock.mockResolvedValue([ann, bob]);
    render(<MembersPanel workspaceId="w-1" canManage={false} currentUserId="u-9" />);
    expect(await screen.findByText(/Bob/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Role of Bob")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Find an employee to add")).not.toBeInTheDocument();
  });

  it("changes a role and reloads", async () => {
    listMembersMock.mockResolvedValue([ann, bob]);
    changeMemberRoleMock.mockResolvedValue({ ...bob, role: "editor" });
    render(<MembersPanel workspaceId="w-1" canManage currentUserId="u-1" />);
    await userEvent.selectOptions(await screen.findByLabelText("Role of Bob"), "editor");
    await waitFor(() =>
      expect(changeMemberRoleMock).toHaveBeenCalledWith("w-1", "u-2", "editor"),
    );
    await waitFor(() => expect(listMembersMock).toHaveBeenCalledTimes(2));
  });

  it("removes a member", async () => {
    listMembersMock.mockResolvedValue([ann, bob]);
    removeMemberMock.mockResolvedValue(undefined);
    render(<MembersPanel workspaceId="w-1" canManage currentUserId="u-1" />);
    await userEvent.click(await screen.findByRole("button", { name: "Remove Bob" }));
    await waitFor(() => expect(removeMemberMock).toHaveBeenCalledWith("w-1", "u-2"));
  });

  it("shows the server's refusal, for example the last admin", async () => {
    listMembersMock.mockResolvedValue([ann]);
    removeMemberMock.mockRejectedValue(new ApiError("A workspace needs an admin.", 409));
    render(<MembersPanel workspaceId="w-1" canManage currentUserId="u-1" />);
    await userEvent.click(await screen.findByRole("button", { name: "Remove Ann" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("needs an admin");
  });

  it("adds an employee found by search, with the chosen role", async () => {
    listMembersMock.mockResolvedValue([ann]);
    searchDirectoryMock.mockResolvedValue([
      { id: "u-1", employee_code: "E1", full_name: "Ann" },
      { id: "u-3", employee_code: "E3", full_name: "Cara" },
    ]);
    addMemberMock.mockResolvedValue({
      user_id: "u-3",
      employee_code: "E3",
      full_name: "Cara",
      role: "commenter",
      is_org_admin: false,
    });
    render(<MembersPanel workspaceId="w-1" canManage currentUserId="u-1" />);
    await screen.findByText(/Ann/);
    await userEvent.selectOptions(screen.getByLabelText("Role of the new member"), "commenter");
    await userEvent.type(screen.getByLabelText("Find an employee to add"), "ca");
    // Ann is already a member, so only Cara is offered.
    expect(await screen.findByRole("button", { name: "Add Cara (E3)" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add Ann/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add Cara (E3)" }));
    await waitFor(() =>
      expect(addMemberMock).toHaveBeenCalledWith("w-1", "u-3", "commenter"),
    );
  });

  it("shows an error when the members cannot be loaded", async () => {
    listMembersMock.mockRejectedValue(new ApiError("You may not see the members.", 403));
    render(<MembersPanel workspaceId="w-1" canManage={false} currentUserId="u-1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("may not see");
  });
});

describe("ManageFieldsPanel: how a date is set", () => {
  const picked = makeField("f-d", "Date", "date", { config: { include_time: false } });
  const auto = makeField("f-a", "Made on", "date", {
    config: { include_time: true, fill: "created" },
  });

  it("switches a date column to being filled when the record is created", async () => {
    updateFieldMock.mockResolvedValue(picked);
    const onChanged = vi.fn();
    render(<ManageFieldsPanel fields={[picked]} onChanged={onChanged} />);
    expect(screen.getByLabelText("Date mode of Date")).toHaveValue("manual");
    await userEvent.selectOptions(screen.getByLabelText("Date mode of Date"), "created");
    await waitFor(() =>
      expect(updateFieldMock).toHaveBeenCalledWith("f-d", {
        config: { include_time: false, fill: "created" },
      }),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("switches back to picking, and keeps the time setting", async () => {
    updateFieldMock.mockResolvedValue(auto);
    render(<ManageFieldsPanel fields={[auto]} onChanged={vi.fn()} />);
    expect(screen.getByLabelText("Date mode of Made on")).toHaveValue("created");
    await userEvent.selectOptions(screen.getByLabelText("Date mode of Made on"), "manual");
    await waitFor(() =>
      expect(updateFieldMock).toHaveBeenCalledWith("f-a", { config: { include_time: true } }),
    );
  });

  it("says that existing records are left alone, and shows the server's refusal", async () => {
    updateFieldMock.mockRejectedValue(new ApiError("Dates and times cannot be switched.", 409));
    render(<ManageFieldsPanel fields={[picked]} onChanged={vi.fn()} />);
    expect(screen.getByText(/left alone/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Date mode of Date"), "created");
    expect(await screen.findByText(/cannot be switched/)).toBeInTheDocument();
  });

  it("offers no such choice for other columns", () => {
    render(<ManageFieldsPanel fields={[makeField("f-n", "Name", "text")]} onChanged={vi.fn()} />);
    expect(screen.queryByLabelText(/^Date mode of/)).not.toBeInTheDocument();
  });
});

describe("ManageFieldsPanel: roles", () => {
  const people = makeField("f-p", "Assign", "user");
  const done = { ...makeField("f-q", "Assigned", "user"), semantic: "assignee", grants_view: true };

  it("warns about a People column without a role, and marks it in the list", () => {
    render(<ManageFieldsPanel fields={[people]} onChanged={vi.fn()} />);
    expect(screen.getByText("no role")).toBeInTheDocument();
    expect(screen.getByText(/Nobody is notified/)).toBeInTheDocument();
  });

  it("gives an existing People column the assignee role", async () => {
    updateFieldMock.mockResolvedValue({ ...people, semantic: "assignee", grants_view: true });
    const onChanged = vi.fn();
    render(<ManageFieldsPanel fields={[people]} onChanged={onChanged} />);
    await userEvent.selectOptions(screen.getByLabelText("Role of Assign"), "assignee");
    await waitFor(() =>
      expect(updateFieldMock).toHaveBeenCalledWith("f-p", { semantic: "assignee" }),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("takes the role away with No role", async () => {
    updateFieldMock.mockResolvedValue({ ...done, semantic: null, grants_view: false });
    render(<ManageFieldsPanel fields={[done]} onChanged={vi.fn()} />);
    expect(screen.getByLabelText("Role of Assigned")).toHaveValue("assignee");
    expect(screen.queryByText(/Nobody is notified/)).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Role of Assigned"), "");
    await waitFor(() => expect(updateFieldMock).toHaveBeenCalledWith("f-q", { semantic: null }));
  });

  it("disables a role that another column of the table has", () => {
    render(<ManageFieldsPanel fields={[people, done]} onChanged={vi.fn()} />);
    const option = within(screen.getByLabelText("Role of Assign")).getByRole("option", {
      name: /Assignee.*already has one/,
    });
    expect(option).toBeDisabled();
  });

  it("shows the server's refusal", async () => {
    updateFieldMock.mockRejectedValue(new ApiError("The table already has a 'assignee' field.", 409));
    render(<ManageFieldsPanel fields={[people]} onChanged={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText("Role of Assign"), "assignee");
    expect(await screen.findByText(/already has a 'assignee' field/)).toBeInTheDocument();
  });

  it("offers no role for a text column or a link column's parent role", () => {
    const parent = { ...makeField("f-l", "Parent", "link_record"), semantic: "parent" };
    render(
      <ManageFieldsPanel fields={[makeField("f-t", "Name", "text"), parent]} onChanged={vi.fn()} />,
    );
    expect(screen.queryByLabelText(/^Role of/)).not.toBeInTheDocument();
  });
});
