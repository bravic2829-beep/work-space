import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchMe } from "@/features/auth/api";
import { AuthProvider } from "@/features/auth/AuthProvider";
import { lookupUsers, searchDirectory } from "@/features/tables/api";
import { resetUserNames } from "@/features/tables/useUserNames";
import { ApiError } from "@/lib/api/client";
import { adminUser, sampleUser } from "@/test/fixtures";

import {
  archiveSheet,
  createSheet,
  listSheetMembers,
  listSheets,
  removeSheetMember,
  renameSheet,
  setSheetMember,
} from "./api";
import { CreateSheetDrawer } from "./CreateSheetDrawer";
import { sheetAccess, type SheetItem, type SheetMemberItem } from "./schema";
import { ShareSheetDrawer } from "./ShareSheetDrawer";
import { ALL_TASKS, SheetTabs } from "./SheetTabs";
import { WorkScreen } from "./WorkScreen";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/features/auth/api", () => ({ fetchMe: vi.fn(), login: vi.fn(), logout: vi.fn() }));
vi.mock("@/features/tables/api", () => ({ lookupUsers: vi.fn(), searchDirectory: vi.fn() }));
vi.mock("./api", () => ({
  listSheets: vi.fn(),
  createSheet: vi.fn(),
  renameSheet: vi.fn(),
  archiveSheet: vi.fn(),
  listSheetMembers: vi.fn(),
  setSheetMember: vi.fn(),
  removeSheetMember: vi.fn(),
}));
// The table inside a tab is tested with the table screen; here only what it is asked to show.
vi.mock("@/features/tables/TableScreen", () => ({
  TableScreen: ({
    tableId,
    sheet,
    addTaskSignal,
  }: {
    tableId: string;
    sheet?: SheetItem;
    addTaskSignal?: number;
  }) => (
    <div data-testid="table">
      {tableId}:{sheet ? sheet.id : "whole table"}
      <span data-testid="signal">{addTaskSignal}</span>
    </div>
  ),
}));

const fetchMeMock = vi.mocked(fetchMe);
const listSheetsMock = vi.mocked(listSheets);

function sheet(id: string, owner: string, overrides: Partial<SheetItem> = {}): SheetItem {
  return {
    id,
    table_id: "t-1",
    table_name: "Tasks",
    owner: { id: `u-${owner}`, full_name: owner, employee_code: owner.slice(0, 2).toUpperCase() },
    name: owner,
    my_role: "manager",
    is_admin: true,
    can_see_all: true,
    member_count: 2,
    ...overrides,
  };
}

const ann = { id: "u-ann", employee_code: "A1", full_name: "Ann" };
const binh = { id: "u-binh", employee_code: "B2", full_name: "Binh" };

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  resetUserNames();
  vi.mocked(lookupUsers).mockResolvedValue([ann, binh]);
  vi.mocked(searchDirectory).mockResolvedValue([ann, binh]);
});

afterEach(cleanup);

describe("sheetAccess", () => {
  const edit = { access: "edit" as const };
  it("lets a manager edit every column and an editor all but the manager's columns", () => {
    expect(sheetAccess("manager", { ...edit, semantic: "feedback" })).toBe("edit");
    expect(sheetAccess("editor", { ...edit, semantic: null })).toBe("edit");
    expect(sheetAccess("editor", { ...edit, semantic: "due_date" })).toBe("edit");
    for (const semantic of ["assignee", "follower", "status", "feedback"]) {
      expect(sheetAccess("editor", { ...edit, semantic })).toBe("read");
    }
  });

  it("keeps a timer column read-only for an editor, whatever its name", () => {
    expect(sheetAccess("editor", { ...edit, semantic: null, type: "timer" })).toBe("read");
    expect(sheetAccess("manager", { ...edit, semantic: null, type: "timer" })).toBe("edit");
  });

  it("gives a commenter or a viewer no editing, and never shows a hidden column", () => {
    expect(sheetAccess("commenter", { ...edit, semantic: null })).toBe("read");
    expect(sheetAccess("viewer", { ...edit, semantic: null })).toBe("read");
    expect(sheetAccess("manager", { access: "hidden", semantic: null })).toBe("hidden");
  });
});

describe("SheetTabs", () => {
  const sheets = [sheet("s-1", "Ann"), sheet("s-2", "Binh")];

  it("lists All tasks and one tab per sheet, and tells which is open", async () => {
    const onSelect = vi.fn();
    render(<SheetTabs sheets={sheets} showAll active={ALL_TASKS} onSelect={onSelect} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["All tasks", "AAnn", "BBinh"]);
    expect(screen.getByRole("tab", { name: "All tasks" })).toHaveAttribute("aria-selected", "true");
    await userEvent.setup().click(screen.getByRole("tab", { name: /Binh/ }));
    expect(onSelect).toHaveBeenCalledWith("s-2");
  });

  it("leaves out All tasks for somebody who only sees their sheets", () => {
    render(<SheetTabs sheets={sheets} showAll={false} active="s-1" onSelect={vi.fn()} />);
    expect(screen.queryByRole("tab", { name: "All tasks" })).not.toBeInTheDocument();
  });

  it("offers Create sheet only when the person may make sheets", () => {
    const { rerender } = render(
      <SheetTabs sheets={sheets} showAll active="s-1" onSelect={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: /Create sheet/ })).not.toBeInTheDocument();
    rerender(<SheetTabs sheets={sheets} showAll active="s-1" onSelect={vi.fn()} onCreate={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Create sheet/ })).toBeInTheDocument();
  });

  it("finds a sheet by name in the list and opens it", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<SheetTabs sheets={sheets} showAll active="s-1" onSelect={onSelect} />);
    await user.click(screen.getByRole("button", { name: /Sheets \(2\)/ }));
    await user.type(screen.getByLabelText("Find a sheet"), "bin");
    const list = screen.getByRole("listbox", { name: "All sheets" });
    expect(within(list).queryByText("Ann")).not.toBeInTheDocument();
    await user.click(within(list).getByText("Binh"));
    expect(onSelect).toHaveBeenCalledWith("s-2");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("says when no sheet matches the search", async () => {
    const user = userEvent.setup();
    render(<SheetTabs sheets={sheets} showAll active="s-1" onSelect={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Sheets \(2\)/ }));
    await user.type(screen.getByLabelText("Find a sheet"), "zzz");
    expect(screen.getByText(/No sheet matches/)).toBeInTheDocument();
  });
});

describe("WorkScreen", () => {
  function renderWork() {
    render(
      <AuthProvider>
        <WorkScreen />
      </AuthProvider>,
    );
  }

  it("opens All tasks for an admin, and a sheet when its tab is chosen", async () => {
    fetchMeMock.mockResolvedValue(adminUser);
    listSheetsMock.mockResolvedValue([sheet("s-1", "Ann"), sheet("s-2", "Binh")]);
    renderWork();
    expect(await screen.findByTestId("table")).toHaveTextContent("t-1:whole table");
    // Share belongs to a sheet, so the whole table has none.
    expect(screen.queryByRole("button", { name: "Share" })).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("tab", { name: /Binh/ }));
    expect(screen.getByTestId("table")).toHaveTextContent("t-1:s-2");
    expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument();
  });

  it("opens the person's own sheet first when they cannot see all tasks", async () => {
    fetchMeMock.mockResolvedValue(sampleUser({ id: "u-Binh" }));
    listSheetsMock.mockResolvedValue([
      sheet("s-1", "Ann", { my_role: "viewer", is_admin: false, can_see_all: false }),
      sheet("s-2", "Binh", { my_role: "editor", is_admin: false, can_see_all: false }),
    ]);
    renderWork();
    expect(await screen.findByTestId("table")).toHaveTextContent("t-1:s-2");
    expect(screen.queryByRole("tab", { name: "All tasks" })).not.toBeInTheDocument();
    // An editor cannot share or make sheets.
    expect(screen.queryByRole("button", { name: "Share" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create sheet/ })).not.toBeInTheDocument();
  });

  it("shows Share on a sheet the person manages, and nothing to share on one they only view", async () => {
    fetchMeMock.mockResolvedValue(sampleUser({ id: "u-x" }));
    listSheetsMock.mockResolvedValue([
      sheet("s-1", "Ann", { my_role: "viewer", is_admin: false, can_see_all: false }),
      sheet("s-2", "Binh", { my_role: "manager", is_admin: false, can_see_all: false }),
    ]);
    renderWork();
    await screen.findByTestId("table");
    expect(screen.queryByRole("button", { name: "Share" })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("tab", { name: /Binh/ }));
    expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument();
  });

  it("keeps Share and Add task in the tab strip, and Add task asks the table to open its form", async () => {
    fetchMeMock.mockResolvedValue(sampleUser({ id: "u-x" }));
    listSheetsMock.mockResolvedValue([
      sheet("s-1", "Ann", { my_role: "viewer", is_admin: false, can_see_all: false }),
      sheet("s-2", "Binh", { my_role: "manager", is_admin: false, can_see_all: false }),
    ]);
    const user = userEvent.setup();
    renderWork();
    await screen.findByTestId("table");
    // A viewer can add nothing.
    expect(screen.queryByRole("button", { name: "Add task" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Binh/ }));
    const strip = screen.getByRole("tablist", { name: "Sheets" }).parentElement as HTMLElement;
    expect(strip).toContainElement(screen.getByRole("button", { name: "Share" }));
    expect(strip).toContainElement(screen.getByRole("button", { name: "Add task" }));

    expect(screen.getByTestId("signal")).toHaveTextContent("0");
    await user.click(screen.getByRole("button", { name: "Add task" }));
    expect(screen.getByTestId("signal")).toHaveTextContent("1");
    await user.click(screen.getByRole("button", { name: "Add task" }));
    expect(screen.getByTestId("signal")).toHaveTextContent("2");
  });

  it("lets an editor add a task but not share the sheet", async () => {
    fetchMeMock.mockResolvedValue(sampleUser({ id: "u-Binh" }));
    listSheetsMock.mockResolvedValue([
      sheet("s-2", "Binh", { my_role: "editor", is_admin: false, can_see_all: false }),
    ]);
    renderWork();
    await screen.findByTestId("table");
    expect(screen.getByRole("button", { name: "Add task" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share" })).not.toBeInTheDocument();
  });

  it("explains an empty list to an admin and to an employee", async () => {
    fetchMeMock.mockResolvedValue(adminUser);
    listSheetsMock.mockResolvedValue([]);
    renderWork();
    expect(await screen.findByText("No sheets yet.")).toBeInTheDocument();
    expect(screen.getByText(/Create sheet/)).toBeInTheDocument();
    cleanup();

    fetchMeMock.mockResolvedValue(sampleUser());
    renderWork();
    expect(await screen.findByText(/Nobody has shared a sheet with you/)).toBeInTheDocument();
  });

  it("lets the person try again when the sheets cannot be loaded", async () => {
    fetchMeMock.mockResolvedValue(adminUser);
    listSheetsMock.mockRejectedValueOnce(new ApiError("Server is down.", 500));
    listSheetsMock.mockResolvedValue([sheet("s-1", "Ann")]);
    renderWork();
    expect(await screen.findByText("Server is down.")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("table")).toBeInTheDocument();
  });

  it("opens the tab used last time in this browser", async () => {
    fetchMeMock.mockResolvedValue(adminUser);
    listSheetsMock.mockResolvedValue([sheet("s-1", "Ann"), sheet("s-2", "Binh")]);
    renderWork();
    await screen.findByTestId("table");
    await userEvent.setup().click(screen.getByRole("tab", { name: /Binh/ }));
    cleanup();

    renderWork();
    expect(await screen.findByTestId("table")).toHaveTextContent("t-1:s-2");
  });

  it("puts pinned sheets first", async () => {
    const user = userEvent.setup();
    fetchMeMock.mockResolvedValue(adminUser);
    listSheetsMock.mockResolvedValue([sheet("s-1", "Ann"), sheet("s-2", "Binh")]);
    renderWork();
    await screen.findByTestId("table");
    await user.click(screen.getByRole("button", { name: /Sheets \(2\)/ }));
    await user.click(screen.getByRole("button", { name: "Pin Binh" }));
    const names = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(names.slice(0, 3)).toEqual(["All tasks", "BBinh", "AAnn"]);
    expect(screen.getByLabelText("Pinned")).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("workbase.work.pins") ?? "[]")).toEqual(["s-2"]);
  });

  it("chooses a table when the sheets belong to several", async () => {
    fetchMeMock.mockResolvedValue(adminUser);
    listSheetsMock.mockResolvedValue([
      sheet("s-1", "Ann"),
      sheet("s-9", "Cai", { table_id: "t-2", table_name: "Projects" }),
    ]);
    renderWork();
    await screen.findByTestId("table");
    await userEvent.setup().selectOptions(screen.getByRole("combobox", { name: "Table" }), "t-2");
    expect(screen.getByTestId("table")).toHaveTextContent("t-2:whole table");
    expect(screen.getByRole("tab", { name: /Cai/ })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Ann/ })).not.toBeInTheDocument();
  });
});

describe("CreateSheetDrawer", () => {
  async function pick(user: ReturnType<typeof userEvent.setup>, label: string, text: string) {
    await user.type(screen.getByLabelText(`Find an employee for ${label}`), "a");
    await user.click(await screen.findByRole("button", { name: `Add ${text}` }));
  }

  it("needs an employee before it can be sent", async () => {
    render(<CreateSheetDrawer tableId="t-1" onCreated={vi.fn()} onClose={vi.fn()} />);
    const send = screen.getByRole("button", { name: "Create sheet" });
    expect(send).toBeDisabled();
    await pick(userEvent.setup(), "Employee", "Ann (A1)");
    expect(send).toBeEnabled();
  });

  it("creates the sheet with the owner, a name and the people it is shared with", async () => {
    const user = userEvent.setup();
    const made = sheet("s-new", "Ann");
    vi.mocked(createSheet).mockResolvedValue(made);
    const onCreated = vi.fn();
    const onClose = vi.fn();
    render(<CreateSheetDrawer tableId="t-1" onCreated={onCreated} onClose={onClose} />);

    await pick(user, "Employee", "Ann (A1)");
    await user.type(screen.getByLabelText("Sheet name"), "  Ann's work ");
    await pick(user, "Also share with", "Binh (B2)");
    await user.selectOptions(screen.getByLabelText("Role of the people added"), "commenter");
    await user.click(screen.getByRole("button", { name: "Create sheet" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(made));
    expect(createSheet).toHaveBeenCalledWith("t-1", {
      owner_id: "u-ann",
      name: "Ann's work",
      members: [{ user_id: "u-binh", role: "commenter" }],
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("leaves the name out when none was typed, and never lists the owner twice", async () => {
    const user = userEvent.setup();
    vi.mocked(createSheet).mockResolvedValue(sheet("s-new", "Ann"));
    render(<CreateSheetDrawer tableId="t-1" onCreated={vi.fn()} onClose={vi.fn()} />);
    await pick(user, "Employee", "Ann (A1)");
    await pick(user, "Also share with", "Ann (A1)");
    await user.click(screen.getByRole("button", { name: "Create sheet" }));
    await waitFor(() => expect(createSheet).toHaveBeenCalled());
    expect(createSheet).toHaveBeenCalledWith("t-1", { owner_id: "u-ann", members: [] });
  });

  it("shows why the server refused and stays open", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    vi.mocked(createSheet).mockRejectedValue(
      new ApiError("This person already has a sheet in this table.", 409),
    );
    render(<CreateSheetDrawer tableId="t-1" onCreated={vi.fn()} onClose={onClose} />);
    await pick(user, "Employee", "Ann (A1)");
    await user.click(screen.getByRole("button", { name: "Create sheet" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already has a sheet");
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("ShareSheetDrawer", () => {
  const MEMBERS: SheetMemberItem[] = [
    { user_id: "u-ann", full_name: "Ann", employee_code: "A1", role: "editor", is_owner: true },
    { user_id: "u-binh", full_name: "Binh", employee_code: "B2", role: "viewer", is_owner: false },
  ];

  function setup(over: Partial<SheetItem> = {}) {
    const props = {
      sheet: sheet("s-1", "Ann", over),
      onRenamed: vi.fn(),
      onArchived: vi.fn(),
      onMembersChanged: vi.fn(),
      onClose: vi.fn(),
    };
    vi.mocked(listSheetMembers).mockResolvedValue(MEMBERS);
    render(<ShareSheetDrawer {...props} />);
    return { ...props, user: userEvent.setup() };
  }

  it("lists the people with their role, the owner first and not removable", async () => {
    setup();
    const list = await screen.findByRole("list", { name: "Sheet members" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Ann");
    expect(rows[0]).toHaveTextContent("Owner");
    expect(screen.getByRole("button", { name: "Remove Ann from the sheet" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove Binh from the sheet" })).toBeEnabled();
    expect(screen.getByLabelText("Role of Binh")).toHaveValue("viewer");
    // The owner can be an editor or a manager, never less.
    const ownerRoles = within(screen.getByLabelText("Role of Ann")).getAllByRole("option");
    expect(ownerRoles.map((o) => o.textContent)).toEqual(["Can edit", "Can manage"]);
  });

  it("explains the two levels and what each role can do", async () => {
    setup();
    await screen.findByRole("list", { name: "Sheet members" });
    expect(screen.getByText(/System admins always see every sheet/)).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByText("Rename, archive the sheet")).toBeInTheDocument();
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Action",
      "Admin",
      "Manage",
      "Edit",
      "Comment",
      "View",
    ]);
  });

  it("changes a role", async () => {
    vi.mocked(setSheetMember).mockResolvedValue({ ...MEMBERS[1], role: "editor" });
    const { user } = setup();
    await screen.findByRole("list", { name: "Sheet members" });
    await user.selectOptions(screen.getByLabelText("Role of Binh"), "editor");
    await waitFor(() => expect(setSheetMember).toHaveBeenCalledWith("s-1", "u-binh", "editor"));
  });

  it("adds people with the chosen role", async () => {
    vi.mocked(setSheetMember).mockResolvedValue(MEMBERS[1]);
    const { user, onMembersChanged } = setup();
    await screen.findByRole("list", { name: "Sheet members" });
    await user.type(screen.getByLabelText("Find an employee for Add people"), "a");
    await user.click(await screen.findByRole("button", { name: "Add Binh (B2)" }));
    await user.selectOptions(screen.getAllByLabelText("Role of the people added")[0], "commenter");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(setSheetMember).toHaveBeenCalledWith("s-1", "u-binh", "commenter"));
    await waitFor(() => expect(onMembersChanged).toHaveBeenCalled());
  });

  it("removes a person", async () => {
    vi.mocked(removeSheetMember).mockResolvedValue(undefined);
    const { user, onMembersChanged } = setup();
    await screen.findByRole("list", { name: "Sheet members" });
    await user.click(screen.getByRole("button", { name: "Remove Binh from the sheet" }));
    await waitFor(() => expect(removeSheetMember).toHaveBeenCalledWith("s-1", "u-binh"));
    await waitFor(() => expect(onMembersChanged).toHaveBeenCalled());
  });

  it("lets an admin rename and archive, and does not offer it to a manager", async () => {
    vi.mocked(renameSheet).mockResolvedValue(sheet("s-1", "Ann", { name: "Ann's work" }));
    vi.mocked(archiveSheet).mockResolvedValue(undefined);
    const { user, onRenamed, onArchived } = setup();
    await screen.findByRole("list", { name: "Sheet members" });

    const input = screen.getByLabelText("Sheet name");
    expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();
    await user.clear(input);
    await user.type(input, "Ann's work");
    await user.click(screen.getByRole("button", { name: "Rename" }));
    await waitFor(() => expect(renameSheet).toHaveBeenCalledWith("s-1", "Ann's work"));
    expect(onRenamed).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Archive sheet" }));
    await user.click(screen.getByRole("button", { name: "Yes, archive" }));
    await waitFor(() => expect(archiveSheet).toHaveBeenCalledWith("s-1"));
    expect(onArchived).toHaveBeenCalled();

    cleanup();
    setup({ is_admin: false });
    await screen.findByRole("list", { name: "Sheet members" });
    expect(screen.queryByLabelText("Sheet name")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive sheet" })).not.toBeInTheDocument();
  });

  it("shows the reason when the server refuses", async () => {
    vi.mocked(setSheetMember).mockRejectedValue(new ApiError("The owner of a sheet always edits it.", 422));
    const { user } = setup();
    await screen.findByRole("list", { name: "Sheet members" });
    await user.selectOptions(screen.getByLabelText("Role of Binh"), "manager");
    expect(await screen.findByRole("alert")).toHaveTextContent("always edits it");
  });
});
