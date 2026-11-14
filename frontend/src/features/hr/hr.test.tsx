import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchMe } from "@/features/auth/api";
import { AuthProvider } from "@/features/auth/AuthProvider";
import { ApiError } from "@/lib/api/client";
import { lookupUsers, searchDirectory } from "@/features/tables/api";
import { resetUserNames } from "@/features/tables/useUserNames";
import { adminUser, sampleUser } from "@/test/fixtures";

import {
  createDepartment,
  createUser,
  deleteDepartment,
  listDepartments,
  listUsers,
  setDepartmentHead,
  updateUser,
} from "./api";
import { DepartmentsPanel } from "./DepartmentsPanel";
import { orderDepartments } from "./departmentTree";
import { HrScreen } from "./HrScreen";
import type { Department } from "./schema";
import { UsersPanel } from "./UsersPanel";

vi.mock("@/features/auth/api", () => ({
  fetchMe: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
}));
vi.mock("./api", () => ({
  listUsers: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  listDepartments: vi.fn(),
  createDepartment: vi.fn(),
  deleteDepartment: vi.fn(),
  setDepartmentHead: vi.fn(),
}));
vi.mock("@/features/tables/api", () => ({
  searchDirectory: vi.fn(),
  lookupUsers: vi.fn(),
}));

const fetchMeMock = vi.mocked(fetchMe);
const listUsersMock = vi.mocked(listUsers);
const createUserMock = vi.mocked(createUser);
const updateUserMock = vi.mocked(updateUser);
const listDepartmentsMock = vi.mocked(listDepartments);
const createDepartmentMock = vi.mocked(createDepartment);
const deleteDepartmentMock = vi.mocked(deleteDepartment);
const setHeadMock = vi.mocked(setDepartmentHead);
const searchMock = vi.mocked(searchDirectory);
const lookupMock = vi.mocked(lookupUsers);
const ann = { id: "u-ann", employee_code: "A1", full_name: "Ann" };

const sales: Department = {
  id: "d-1",
  name: "Sales",
  kind: "division",
  parent_id: null,
  head_user_id: null,
};
const teamA: Department = {
  id: "d-2",
  name: "Team A",
  kind: "department",
  parent_id: "d-1",
  head_user_id: null,
};
const departments = [sales, teamA];

const employee = sampleUser({
  id: "u-2",
  employee_code: "E002",
  full_name: "Tran Thi B",
  department_id: "d-2",
});
const owner = sampleUser({
  id: "u-0",
  employee_code: "OWNER",
  full_name: "The Owner",
  org_role: "owner",
  level: "admin",
});

beforeEach(() => {
  vi.resetAllMocks();
  resetUserNames();
  lookupMock.mockResolvedValue([ann]);
  searchMock.mockResolvedValue([ann]);
  fetchMeMock.mockResolvedValue(adminUser);
});

function renderUsers(deps: Department[] = departments) {
  return render(
    <AuthProvider>
      <UsersPanel departments={deps} />
    </AuthProvider>,
  );
}

function row(code: string): HTMLElement {
  return screen.getByRole("row", { name: new RegExp(code) });
}

/** A row whose text starts with the name: "Sales" is also written in the row of its departments. */
function startRow(name: string): HTMLElement {
  return screen.getByRole("row", { name: new RegExp(`^${name}`) });
}

describe("UsersPanel: listing", () => {
  it("shows a loading state, then the employees with their department names", async () => {
    listUsersMock.mockResolvedValue({ items: [employee], next_cursor: null });
    renderUsers();
    expect(screen.getByRole("status")).toHaveTextContent("Loading employees");

    expect(await screen.findByText("Tran Thi B")).toBeInTheDocument();
    const cells = within(row("E002")).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("E002");
    expect(cells[1]).toHaveTextContent("Tran Thi B");
    expect(cells[2]).toHaveTextContent("Employee");
    expect(cells[3]).toHaveTextContent("Team A");
    expect(cells[4]).toHaveTextContent("Active");
    expect(screen.getByText("1 employee")).toBeInTheDocument();
  });

  it("says so when there is nobody yet, and when nobody matches", async () => {
    listUsersMock.mockResolvedValue({ items: [], next_cursor: null });
    renderUsers();
    expect(await screen.findByText("No employees yet.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "Disabled" }));
    expect(await screen.findByText("No employees match.")).toBeInTheDocument();
  });

  it("shows the error when loading fails", async () => {
    listUsersMock.mockRejectedValue(new ApiError("You do not have permission to do this.", 403));
    renderUsers();
    expect(await screen.findByRole("alert")).toHaveTextContent("do not have permission");
  });

  it("searches as you type, after a short pause, together with the chosen status", async () => {
    listUsersMock.mockResolvedValue({ items: [], next_cursor: null });
    renderUsers();
    await screen.findByText("No employees yet.");
    listUsersMock.mockClear();

    await userEvent.click(screen.getByRole("radio", { name: "Disabled" }));
    await userEvent.type(screen.getByLabelText("Search employees"), "  mai ");

    await waitFor(() =>
      expect(listUsersMock).toHaveBeenLastCalledWith(
        { q: "mai", status: "disabled" },
        null,
        expect.anything(),
      ),
    );
    // One request for the status and one for the pause after typing, not one per letter.
    expect(listUsersMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the rows on screen while a new search loads", async () => {
    listUsersMock.mockResolvedValueOnce({ items: [employee], next_cursor: null });
    renderUsers();
    await screen.findByText("Tran Thi B");

    listUsersMock.mockReturnValueOnce(new Promise(() => {}));
    await userEvent.click(screen.getByRole("radio", { name: "Active" }));

    expect(screen.getByText("Tran Thi B")).toBeInTheDocument();
  });

  it("loads the next page with the cursor and appends it", async () => {
    listUsersMock.mockResolvedValueOnce({
      items: [employee],
      next_cursor: "CURSOR1",
    });
    renderUsers();
    await screen.findByText("Tran Thi B");
    expect(screen.getByText("1+ employees")).toBeInTheDocument();

    listUsersMock.mockResolvedValueOnce({
      items: [sampleUser({ id: "u-3", employee_code: "E003", full_name: "Le Van C" })],
      next_cursor: null,
    });
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByText("Le Van C")).toBeInTheDocument();
    expect(screen.getByText("Tran Thi B")).toBeInTheDocument();
    expect(listUsersMock).toHaveBeenLastCalledWith({ q: "", status: "" }, "CURSOR1");
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("shows an error when the next page fails and keeps what is already there", async () => {
    listUsersMock.mockResolvedValueOnce({
      items: [employee],
      next_cursor: "CURSOR1",
    });
    renderUsers();
    await screen.findByText("Tran Thi B");

    listUsersMock.mockRejectedValueOnce(new ApiError("Network error"));
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Network error");
    expect(screen.getByText("Tran Thi B")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load more" })).toBeEnabled();
  });
});

describe("UsersPanel: row actions", () => {
  it("offers no actions on the owner, and no disabling of yourself", async () => {
    listUsersMock.mockResolvedValue({
      items: [owner, { ...adminUser }, employee],
      next_cursor: null,
    });
    renderUsers();
    await screen.findByText("The Owner");
    await screen.findByText("You");

    expect(within(row("OWNER")).queryByRole("button")).not.toBeInTheDocument();
    // The signed-in admin may edit their own row but not disable it.
    const own = within(row("ADMIN"));
    expect(own.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(own.queryByRole("button", { name: "Disable" })).not.toBeInTheDocument();
    expect(within(row("E002")).getByRole("button", { name: "Disable" })).toBeInTheDocument();
  });

  it("asks first, then disables the employee and reloads the list", async () => {
    listUsersMock.mockResolvedValue({ items: [employee], next_cursor: null });
    updateUserMock.mockResolvedValue({ ...employee, status: "disabled" });
    renderUsers();
    await screen.findByText("Tran Thi B");

    await userEvent.click(within(row("E002")).getByRole("button", { name: "Disable" }));
    // Nothing is sent until the question is answered.
    expect(updateUserMock).not.toHaveBeenCalled();

    listUsersMock.mockResolvedValue({
      items: [{ ...employee, status: "disabled" }],
      next_cursor: null,
    });
    await userEvent.click(within(row("E002")).getByRole("button", { name: "Yes, disable" }));

    await waitFor(() => expect(updateUserMock).toHaveBeenCalledWith("u-2", { status: "disabled" }));
    // "Disabled" is also an option of the status filter, so look inside the employee's row.
    await waitFor(() => expect(within(row("E002")).getByText("Disabled")).toBeInTheDocument());
    expect(within(row("E002")).getByRole("button", { name: "Enable" })).toBeInTheDocument();
  });

  it("does nothing when the question is cancelled", async () => {
    listUsersMock.mockResolvedValue({ items: [employee], next_cursor: null });
    renderUsers();
    await screen.findByText("Tran Thi B");

    await userEvent.click(within(row("E002")).getByRole("button", { name: "Disable" }));
    await userEvent.click(within(row("E002")).getByRole("button", { name: "Cancel" }));

    expect(updateUserMock).not.toHaveBeenCalled();
    expect(within(row("E002")).getByRole("button", { name: "Disable" })).toBeInTheDocument();
  });

  it("enables a disabled employee at once, without a question", async () => {
    const off = { ...employee, status: "disabled" as const };
    listUsersMock.mockResolvedValue({ items: [off], next_cursor: null });
    updateUserMock.mockResolvedValue(employee);
    renderUsers();
    await screen.findByText("Tran Thi B");

    await userEvent.click(within(row("E002")).getByRole("button", { name: "Enable" }));

    await waitFor(() => expect(updateUserMock).toHaveBeenCalledWith("u-2", { status: "active" }));
  });

  it("shows the server's refusal and keeps the row", async () => {
    listUsersMock.mockResolvedValue({ items: [employee], next_cursor: null });
    updateUserMock.mockRejectedValue(new ApiError("The owner account cannot be changed.", 403));
    renderUsers();
    await screen.findByText("Tran Thi B");

    await userEvent.click(within(row("E002")).getByRole("button", { name: "Disable" }));
    await userEvent.click(within(row("E002")).getByRole("button", { name: "Yes, disable" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("cannot be changed");
    expect(screen.getByText("Tran Thi B")).toBeInTheDocument();
  });
});

describe("UsersPanel: edit drawer", () => {
  async function openEditor(code = "E002") {
    await userEvent.click(within(row(code)).getByRole("button", { name: "Edit" }));
    return screen.getByRole("form", { name: `Edit ${code}` });
  }

  it("opens from the Edit button and from a click on the row", async () => {
    listUsersMock.mockResolvedValue({ items: [employee], next_cursor: null });
    renderUsers();
    await screen.findByText("Tran Thi B");

    await openEditor();
    expect(screen.getByRole("dialog", { name: "Tran Thi B" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close panel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await userEvent.click(screen.getByText("Tran Thi B"));
    expect(screen.getByRole("dialog", { name: "Tran Thi B" })).toBeInTheDocument();
  });

  it("does not open for the owner", async () => {
    listUsersMock.mockResolvedValue({ items: [owner], next_cursor: null });
    renderUsers();
    await userEvent.click(await screen.findByText("The Owner"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("puts the cursor in the first field, and Escape closes it", async () => {
    listUsersMock.mockResolvedValue({ items: [employee], next_cursor: null });
    renderUsers();
    await screen.findByText("Tran Thi B");

    const form = await openEditor();
    expect(within(form).getByLabelText("Full name")).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // The focus goes back to the button that opened it.
    expect(within(row("E002")).getByRole("button", { name: "Edit" })).toHaveFocus();
  });

  it("edits the name, department and level of an employee, then closes", async () => {
    listUsersMock.mockResolvedValue({ items: [employee], next_cursor: null });
    updateUserMock.mockResolvedValue(employee);
    renderUsers();
    await screen.findByText("Tran Thi B");

    const form = await openEditor();
    const name = within(form).getByLabelText("Full name");
    await userEvent.clear(name);
    await userEvent.type(name, "  Tran Thi Bich ");
    await userEvent.selectOptions(within(form).getByLabelText("Level"), "department_manager");
    await userEvent.selectOptions(within(form).getByLabelText("Department"), "d-1");
    await userEvent.click(within(form).getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updateUserMock).toHaveBeenCalledWith("u-2", {
        full_name: "Tran Thi Bich",
        department_id: "d-1",
        level: "department_manager",
        org_role: "member",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("lists the departments with their division in the choice", async () => {
    listUsersMock.mockResolvedValue({ items: [employee], next_cursor: null });
    renderUsers();
    await screen.findByText("Tran Thi B");

    const form = await openEditor();
    const options = within(within(form).getByLabelText("Department")).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["None", "Sales", "Sales / Team A"]);
  });

  it("promoting to the admin level also sends the admin organization role", async () => {
    listUsersMock.mockResolvedValue({ items: [employee], next_cursor: null });
    updateUserMock.mockResolvedValue(employee);
    renderUsers();
    await screen.findByText("Tran Thi B");

    const form = await openEditor();
    await userEvent.selectOptions(within(form).getByLabelText("Level"), "admin");
    await userEvent.click(within(form).getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updateUserMock).toHaveBeenCalledWith(
        "u-2",
        expect.objectContaining({ level: "admin", org_role: "admin" }),
      ),
    );
  });

  it("cannot change your own level, and clearing the department sends null", async () => {
    const me = { ...adminUser, department_id: "d-1" };
    listUsersMock.mockResolvedValue({ items: [me], next_cursor: null });
    updateUserMock.mockResolvedValue(me);
    renderUsers();
    await screen.findByText("You");

    const form = await openEditor("ADMIN");
    expect(within(form).getByLabelText("Level")).toBeDisabled();
    expect(screen.getByText("You cannot change this level.")).toBeInTheDocument();
    await userEvent.selectOptions(within(form).getByLabelText("Department"), "");
    await userEvent.click(within(form).getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updateUserMock).toHaveBeenCalledWith("admin-1", {
        full_name: "Admin User",
        department_id: null,
      }),
    );
  });

  it("shows the server's refusal inside the drawer and keeps it open", async () => {
    listUsersMock.mockResolvedValue({ items: [employee], next_cursor: null });
    updateUserMock.mockRejectedValue(new ApiError("The department does not exist.", 422));
    renderUsers();
    await screen.findByText("Tran Thi B");

    const form = await openEditor();
    await userEvent.click(within(form).getByRole("button", { name: "Save changes" }));

    expect(await within(form).findByRole("alert")).toHaveTextContent("does not exist");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("cancel closes the drawer without saving", async () => {
    listUsersMock.mockResolvedValue({ items: [employee], next_cursor: null });
    renderUsers();
    await screen.findByText("Tran Thi B");

    const form = await openEditor();
    await userEvent.click(within(form).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(updateUserMock).not.toHaveBeenCalled();
  });
});

describe("Add employee drawer", () => {
  async function openNewEmployee(deps: Department[] = departments) {
    listUsersMock.mockResolvedValue({ items: [], next_cursor: null });
    renderUsers(deps);
    await screen.findByText("No employees yet.");
    await userEvent.click(screen.getByRole("button", { name: "New employee" }));
    return screen.getByRole("form", { name: "Add employee" });
  }

  it("opens with the cursor in the employee code", async () => {
    const form = await openNewEmployee();
    expect(screen.getByRole("dialog", { name: "New employee" })).toBeInTheDocument();
    expect(within(form).getByLabelText("Employee code")).toHaveFocus();
  });

  it("creates an employee with a normal level as a member, and stays open for the next", async () => {
    createUserMock.mockResolvedValue(employee);
    const form = await openNewEmployee();

    await userEvent.type(within(form).getByLabelText("Employee code"), " NV100 ");
    await userEvent.type(within(form).getByLabelText("Full name"), "Nguyen Van B");
    await userEvent.type(within(form).getByLabelText("Initial password"), "Initial-Pass-1");
    await userEvent.selectOptions(within(form).getByLabelText("Department"), "d-2");
    await userEvent.click(within(form).getByRole("button", { name: "Add employee" }));

    await waitFor(() =>
      expect(createUserMock).toHaveBeenCalledWith({
        employee_code: "NV100",
        full_name: "Nguyen Van B",
        password: "Initial-Pass-1",
        level: "employee",
        org_role: "member",
        department_id: "d-2",
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Employee E002 created.");
    // The form is emptied, so the initial password does not stay on screen, and it is ready
    // for the next employee.
    expect(within(form).getByLabelText("Initial password")).toHaveValue("");
    expect(within(form).getByLabelText("Employee code")).toHaveValue("");
    expect(within(form).getByLabelText("Employee code")).toHaveFocus();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("the admin level also sends the admin organization role, no department means null", async () => {
    createUserMock.mockResolvedValue(employee);
    const form = await openNewEmployee([]);

    await userEvent.type(within(form).getByLabelText("Employee code"), "BOSS");
    await userEvent.type(within(form).getByLabelText("Full name"), "The Boss");
    await userEvent.type(within(form).getByLabelText("Initial password"), "Initial-Pass-1");
    await userEvent.selectOptions(within(form).getByLabelText("Level"), "admin");
    await userEvent.click(within(form).getByRole("button", { name: "Add employee" }));

    await waitFor(() =>
      expect(createUserMock).toHaveBeenCalledWith(
        expect.objectContaining({
          level: "admin",
          org_role: "admin",
          department_id: null,
        }),
      ),
    );
  });

  it("shows a conflict and keeps what was typed", async () => {
    createUserMock.mockRejectedValue(new ApiError("This employee code is already in use.", 409));
    const form = await openNewEmployee();

    await userEvent.type(within(form).getByLabelText("Employee code"), "NV100");
    await userEvent.type(within(form).getByLabelText("Full name"), "Nguyen Van B");
    await userEvent.type(within(form).getByLabelText("Initial password"), "Initial-Pass-1");
    await userEvent.click(within(form).getByRole("button", { name: "Add employee" }));

    expect(await within(form).findByRole("alert")).toHaveTextContent("already in use");
    expect(within(form).getByLabelText("Employee code")).toHaveValue("NV100");
    expect(within(form).getByRole("button", { name: "Add employee" })).toBeEnabled();
  });

  it("lists the per-field errors of a rejected submission", async () => {
    createUserMock.mockRejectedValue(
      new ApiError("One or more fields are invalid.", 422, [
        { field: "department_id", message: "The department does not exist." },
      ]),
    );
    const form = await openNewEmployee();

    await userEvent.type(within(form).getByLabelText("Employee code"), "NV100");
    await userEvent.type(within(form).getByLabelText("Full name"), "Nguyen Van B");
    await userEvent.type(within(form).getByLabelText("Initial password"), "Initial-Pass-1");
    await userEvent.click(within(form).getByRole("button", { name: "Add employee" }));

    expect(
      await within(form).findByText(/department_id: The department does not exist/),
    ).toBeInTheDocument();
  });

  it("Close closes it without creating anyone", async () => {
    const form = await openNewEmployee();
    await userEvent.click(within(form).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(createUserMock).not.toHaveBeenCalled();
  });
});

describe("orderDepartments", () => {
  it("puts each division first, its departments after it, and loose departments last", () => {
    const loose: Department = { ...teamA, id: "d-3", name: "Alpha", parent_id: null };
    const ops: Department = { ...sales, id: "d-4", name: "Operations" };
    const rows = orderDepartments([teamA, loose, ops, sales]);
    expect(rows.map((r) => [r.item.name, r.depth])).toEqual([
      ["Operations", 0],
      ["Sales", 0],
      ["Team A", 1],
      ["Alpha", 0],
    ]);
  });

  it("treats a department whose division is missing as a loose one", () => {
    const orphan: Department = { ...teamA, parent_id: "gone" };
    expect(orderDepartments([orphan]).map((r) => [r.item.name, r.depth])).toEqual([["Team A", 0]]);
  });
});

describe("DepartmentsPanel", () => {
  function renderDepartments(items: Department[] = departments) {
    const onChanged = vi.fn();
    render(<DepartmentsPanel departments={items} onChanged={onChanged} />);
    return onChanged;
  }

  function openNewDepartment() {
    return userEvent
      .click(screen.getByRole("button", { name: "New department" }))
      .then(() => screen.getByRole("form", { name: "Add department" }));
  }

  it("lists a division, then its departments, with their kind and parent", () => {
    renderDepartments([teamA, sales]);
    const names = screen
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("cell")[0].textContent);
    expect(names).toEqual(["Sales", "Team A"]);

    const division = within(startRow("Sales")).getAllByRole("cell");
    expect(division[1]).toHaveTextContent("Division");
    expect(division[2]).toHaveTextContent("—");
    const team = within(row("Team A")).getAllByRole("cell");
    expect(team[1]).toHaveTextContent("Department");
    expect(team[2]).toHaveTextContent("Sales");
  });

  it("shows the head of a department and lets an admin remove them", async () => {
    setHeadMock.mockResolvedValue({ ...teamA, head_user_id: null });
    const onChanged = renderDepartments([sales, { ...teamA, head_user_id: "u-ann" }]);
    const user = userEvent.setup();

    // The name and the code are shown side by side.
    expect(await within(row("Team A")).findByText("Ann")).toBeInTheDocument();
    expect(within(row("Team A")).getByText("A1")).toBeInTheDocument();
    await user.click(
      within(row("Team A")).getByRole("button", { name: "Remove head of Team A" }),
    );

    expect(setHeadMock).toHaveBeenCalledWith("d-2", null);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("sets the head by searching for an employee, and the search opens only on request", async () => {
    setHeadMock.mockResolvedValue({ ...teamA, head_user_id: "u-ann" });
    const onChanged = renderDepartments();
    const user = userEvent.setup();

    expect(screen.queryByLabelText("Find an employee for Head of Team A")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Assign head of Team A" }));
    await user.type(screen.getByLabelText("Find an employee for Head of Team A"), "an");
    await user.click(await screen.findByRole("button", { name: "Add Ann (A1)" }));

    expect(setHeadMock).toHaveBeenCalledWith("d-2", "u-ann");
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("changes the head of a department that already has one", async () => {
    setHeadMock.mockResolvedValue({ ...teamA, head_user_id: "u-ann" });
    renderDepartments([sales, { ...teamA, head_user_id: "u-old" }]);
    lookupMock.mockResolvedValue([{ id: "u-old", employee_code: "O1", full_name: "Old" }, ann]);
    const user = userEvent.setup();

    await user.click(
      await within(row("Team A")).findByRole("button", { name: "Change head of Team A" }),
    );
    await user.type(screen.getByLabelText("Find an employee for Head of Team A"), "an");
    await user.click(await screen.findByRole("button", { name: "Add Ann (A1)" }));

    expect(setHeadMock).toHaveBeenCalledWith("d-2", "u-ann");
  });

  it("can leave the search without choosing", async () => {
    renderDepartments();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Assign head of Team A" }));
    await user.click(within(row("Team A")).getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("button", { name: "Assign head of Team A" })).toBeInTheDocument();
    expect(setHeadMock).not.toHaveBeenCalled();
  });

  it("shows the error when the head cannot be set", async () => {
    setHeadMock.mockRejectedValue(new ApiError("The head does not exist or is disabled.", 422));
    const onChanged = renderDepartments();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Assign head of Team A" }));
    await user.type(screen.getByLabelText("Find an employee for Head of Team A"), "an");
    await user.click(await screen.findByRole("button", { name: "Add Ann (A1)" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The head does not exist or is disabled.",
    );
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("says so when there are none, and offers to add one", async () => {
    renderDepartments([]);
    expect(screen.getByText("No departments yet.")).toBeInTheDocument();
    await openNewDepartment();
    expect(screen.getByRole("dialog", { name: "New department" })).toBeInTheDocument();
  });

  it("filters by the name of the department or of its division", async () => {
    renderDepartments();
    const filter = screen.getByLabelText("Filter departments");

    await userEvent.type(filter, "team");
    expect(screen.queryByRole("row", { name: /^Sales/ })).not.toBeInTheDocument();
    expect(row("Team A")).toBeInTheDocument();

    await userEvent.clear(filter);
    await userEvent.type(filter, "sales");
    expect(startRow("Sales")).toBeInTheDocument();
    expect(row("Team A")).toBeInTheDocument();

    await userEvent.clear(filter);
    await userEvent.type(filter, "zzz");
    expect(screen.getByText("No department matches.")).toBeInTheDocument();
  });

  it("creates a division without a parent, and stays open for the next one", async () => {
    createDepartmentMock.mockResolvedValue(sales);
    const onChanged = renderDepartments();
    const form = await openNewDepartment();

    await userEvent.click(within(form).getByRole("radio", { name: "Division" }));
    expect(within(form).queryByLabelText("Under division")).not.toBeInTheDocument();
    await userEvent.type(within(form).getByLabelText("Name"), "  Operations ");
    await userEvent.click(within(form).getByRole("button", { name: "Add department" }));

    await waitFor(() =>
      expect(createDepartmentMock).toHaveBeenCalledWith({
        name: "Operations",
        kind: "division",
        parent_id: null,
      }),
    );
    expect(onChanged).toHaveBeenCalled();
    expect(await screen.findByRole("status")).toHaveTextContent("Created “Operations”");
    expect(within(form).getByLabelText("Name")).toHaveValue("");
    expect(within(form).getByLabelText("Name")).toHaveFocus();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("starts as a department and explains the difference", async () => {
    renderDepartments();
    const form = await openNewDepartment();
    expect(within(form).getByRole("radio", { name: "Department" })).toBeChecked();
    expect(within(form).getByText(/A department is a team/)).toBeInTheDocument();

    await userEvent.click(within(form).getByRole("radio", { name: "Division" }));
    expect(within(form).getByText(/A division groups several departments/)).toBeInTheDocument();
  });

  it("creates a department under a division chosen from divisions only", async () => {
    createDepartmentMock.mockResolvedValue(teamA);
    renderDepartments();
    const form = await openNewDepartment();

    const parent = within(form).getByLabelText("Under division");
    expect(
      within(parent)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["None (top level)", "Sales"]);
    await userEvent.selectOptions(parent, "d-1");
    await userEvent.type(within(form).getByLabelText("Name"), "Team B");
    await userEvent.click(within(form).getByRole("button", { name: "Add department" }));

    await waitFor(() =>
      expect(createDepartmentMock).toHaveBeenCalledWith({
        name: "Team B",
        kind: "department",
        parent_id: "d-1",
      }),
    );
    // The division is kept for the next department.
    expect(within(form).getByLabelText("Under division")).toHaveValue("d-1");
  });

  it("creates a top-level department when no division is chosen", async () => {
    createDepartmentMock.mockResolvedValue(teamA);
    renderDepartments();
    const form = await openNewDepartment();

    await userEvent.type(within(form).getByLabelText("Name"), "Finance");
    await userEvent.click(within(form).getByRole("button", { name: "Add department" }));

    await waitFor(() =>
      expect(createDepartmentMock).toHaveBeenCalledWith({
        name: "Finance",
        kind: "department",
        parent_id: null,
      }),
    );
  });

  it("shows the server's refusal (duplicate name) and keeps the name", async () => {
    createDepartmentMock.mockRejectedValue(
      new ApiError("A department with this name already exists here.", 409),
    );
    const onChanged = renderDepartments();
    const form = await openNewDepartment();
    await userEvent.type(within(form).getByLabelText("Name"), "Sales");
    await userEvent.click(within(form).getByRole("button", { name: "Add department" }));

    expect(await within(form).findByRole("alert")).toHaveTextContent("already exists");
    expect(within(form).getByLabelText("Name")).toHaveValue("Sales");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("deletes only after the user confirms in the row", async () => {
    deleteDepartmentMock.mockResolvedValue(undefined);
    const onChanged = renderDepartments();

    await userEvent.click(within(row("Team A")).getByRole("button", { name: "Delete" }));
    expect(within(row("Team A")).getByText("Delete Team A?")).toBeInTheDocument();
    await userEvent.click(within(row("Team A")).getByRole("button", { name: "Cancel" }));
    expect(deleteDepartmentMock).not.toHaveBeenCalled();

    await userEvent.click(within(row("Team A")).getByRole("button", { name: "Delete" }));
    await userEvent.click(within(row("Team A")).getByRole("button", { name: "Yes, delete" }));
    await waitFor(() => expect(deleteDepartmentMock).toHaveBeenCalledWith("d-2"));
    expect(onChanged).toHaveBeenCalled();
  });

  it("shows why a department could not be deleted", async () => {
    deleteDepartmentMock.mockRejectedValue(
      new ApiError("The department still has employees.", 409),
    );
    renderDepartments();

    await userEvent.click(within(row("Team A")).getByRole("button", { name: "Delete" }));
    await userEvent.click(within(row("Team A")).getByRole("button", { name: "Yes, delete" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("still has employees");
  });
});

describe("HrScreen", () => {
  function renderScreen() {
    return render(
      <AuthProvider>
        <HrScreen />
      </AuthProvider>,
    );
  }

  it("loads the departments, then shows the employees, with the departments one tab away", async () => {
    listDepartmentsMock.mockResolvedValue(departments);
    listUsersMock.mockResolvedValue({ items: [employee], next_cursor: null });
    renderScreen();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Human resources" })).toBeInTheDocument();
    expect(await screen.findByText("Tran Thi B")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Employees/ })).toHaveAttribute("aria-selected", "true");
    // The count in the tab is the number of departments.
    expect(screen.getByRole("tab", { name: /Departments/ })).toHaveTextContent("2");
    expect(screen.queryByRole("table", { name: "Departments" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: /Departments/ }));
    expect(screen.getByRole("table", { name: "Departments" })).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Employees" })).not.toBeInTheDocument();
  });

  it("moves between the tabs with the arrow keys", async () => {
    listDepartmentsMock.mockResolvedValue(departments);
    listUsersMock.mockResolvedValue({ items: [], next_cursor: null });
    renderScreen();

    const employees = await screen.findByRole("tab", { name: /Employees/ });
    employees.focus();
    await userEvent.keyboard("{ArrowRight}");

    expect(screen.getByRole("tab", { name: /Departments/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: /Departments/ })).toHaveFocus();
  });

  it("keeps a search when you visit the other tab and come back", async () => {
    listDepartmentsMock.mockResolvedValue(departments);
    listUsersMock.mockResolvedValue({ items: [employee], next_cursor: null });
    renderScreen();
    await screen.findByText("Tran Thi B");

    await userEvent.type(screen.getByLabelText("Search employees"), "tran");
    await userEvent.click(screen.getByRole("tab", { name: /Departments/ }));
    await userEvent.click(screen.getByRole("tab", { name: /Employees/ }));

    expect(screen.getByLabelText("Search employees")).toHaveValue("tran");
  });

  it("shows an error, and no employee data, when departments cannot be loaded", async () => {
    listDepartmentsMock.mockRejectedValue(
      new ApiError("You do not have permission to do this.", 403),
    );
    renderScreen();

    expect(await screen.findByRole("alert")).toHaveTextContent("do not have permission");
    expect(listUsersMock).not.toHaveBeenCalled();
  });
});
