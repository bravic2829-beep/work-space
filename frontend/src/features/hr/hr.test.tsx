import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components/ui";
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
  resetPassword,
  updateDepartment,
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
  resetPassword: vi.fn(),
  listDepartments: vi.fn(),
  createDepartment: vi.fn(),
  deleteDepartment: vi.fn(),
  updateDepartment: vi.fn(),
}));
vi.mock("@/features/tables/api", () => ({
  searchDirectory: vi.fn(),
  lookupUsers: vi.fn(),
}));

const fetchMeMock = vi.mocked(fetchMe);
const listUsersMock = vi.mocked(listUsers);
const createUserMock = vi.mocked(createUser);
const updateUserMock = vi.mocked(updateUser);
const resetPasswordMock = vi.mocked(resetPassword);
const listDepartmentsMock = vi.mocked(listDepartments);
const createDepartmentMock = vi.mocked(createDepartment);
const deleteDepartmentMock = vi.mocked(deleteDepartment);
const updateDepartmentMock = vi.mocked(updateDepartment);
const searchMock = vi.mocked(searchDirectory);
const lookupMock = vi.mocked(lookupUsers);
const ann = { id: "u-ann", employee_code: "A1", full_name: "Ann" };

const sales: Department = {
  id: "d-1",
  name: "Sales",
  kind: "division",
  parent_id: null,
  head_user_id: null,
  member_count: 0,
};
const teamA: Department = {
  id: "d-2",
  name: "Team A",
  kind: "department",
  parent_id: "d-1",
  head_user_id: null,
  member_count: 1,
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
      <ToastProvider>
        <UsersPanel
          departments={deps}
          departmentId=""
          onDepartmentChange={vi.fn()}
          onChanged={vi.fn()}
        />
      </ToastProvider>
    </AuthProvider>,
  );
}

/** Opens the "..." menu of an employee's row. */
async function openMenu(code: string) {
  await userEvent.click(within(row(code)).getByRole("button", { name: /^Actions for/ }));
}

async function choose(name: string) {
  await userEvent.click(screen.getByRole("menuitem", { name }));
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
    expect(screen.getByText("Loading employees…")).toBeInTheDocument();

    expect(await screen.findByText("Tran Thi B")).toBeInTheDocument();
    const cells = within(row("E002")).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("E002");
    expect(cells[0]).toHaveTextContent("Tran Thi B");
    expect(cells[1]).toHaveTextContent("Employee");
    // The department, and the division it is in, quietly after it.
    expect(cells[2]).toHaveTextContent("Team A · Sales");
    expect(cells[3]).toHaveTextContent("—");
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
        { q: "mai", status: "disabled", departmentId: "" },
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
    expect(listUsersMock).toHaveBeenLastCalledWith({ q: "", status: "", departmentId: "" }, "CURSOR1");
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
    // The signed-in admin may edit their own row but not disable it or reset their password.
    await openMenu("ADMIN");
    expect(screen.getByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Disable/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Reset password/ })).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await openMenu("E002");
    expect(screen.getByRole("menuitem", { name: "Disable…" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Reset password…" })).toBeInTheDocument();
  });

  it("asks first, then disables the employee and reloads the list", async () => {
    listUsersMock.mockResolvedValue({ items: [employee], next_cursor: null });
    updateUserMock.mockResolvedValue({ ...employee, status: "disabled" });
    renderUsers();
    await screen.findByText("Tran Thi B");

    await openMenu("E002");
    await choose("Disable…");
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
    await openMenu("E002");
    expect(screen.getByRole("menuitem", { name: "Enable" })).toBeInTheDocument();
  });

  it("does nothing when the question is cancelled", async () => {
    listUsersMock.mockResolvedValue({ items: [employee], next_cursor: null });
    renderUsers();
    await screen.findByText("Tran Thi B");

    await openMenu("E002");
    await choose("Disable…");
    await userEvent.click(within(row("E002")).getByRole("button", { name: "Cancel" }));

    expect(updateUserMock).not.toHaveBeenCalled();
    expect(within(row("E002")).getByRole("button", { name: /^Actions for/ })).toBeInTheDocument();
  });

  it("enables a disabled employee at once, without a question", async () => {
    const off = { ...employee, status: "disabled" as const };
    listUsersMock.mockResolvedValue({ items: [off], next_cursor: null });
    updateUserMock.mockResolvedValue(employee);
    renderUsers();
    await screen.findByText("Tran Thi B");

    await openMenu("E002");
    await choose("Enable");

    await waitFor(() => expect(updateUserMock).toHaveBeenCalledWith("u-2", { status: "active" }));
  });

  it("shows the server's refusal and keeps the row", async () => {
    listUsersMock.mockResolvedValue({ items: [employee], next_cursor: null });
    updateUserMock.mockRejectedValue(new ApiError("The owner account cannot be changed.", 403));
    renderUsers();
    await screen.findByText("Tran Thi B");

    await openMenu("E002");
    await choose("Disable…");
    await userEvent.click(within(row("E002")).getByRole("button", { name: "Yes, disable" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("cannot be changed");
    expect(screen.getByText("Tran Thi B")).toBeInTheDocument();
  });
});

describe("UsersPanel: edit drawer", () => {
  async function openEditor(code = "E002") {
    await openMenu(code);
    await choose("Edit");
    return screen.getByRole("form", { name: `Edit ${code}` });
  }

  it("opens from the menu and from a click on the row", async () => {
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
    await userEvent.click(within(form).getByRole("radio", { name: /^Department manager/ }));
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
    await userEvent.click(within(form).getByRole("radio", { name: /^Admin/ }));
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
    for (const radio of within(form).getAllByRole("radio")) expect(radio).toBeDisabled();
    expect(screen.getByText("You cannot change this level.")).toBeInTheDocument();
    // Nor your own status or password: there is no Account group on your own row.
    expect(within(form).queryByRole("radiogroup", { name: "Account status" })).not.toBeInTheDocument();
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

describe("UsersPanel: reset password", () => {
  async function openEditor(code = "E002") {
    await openMenu(code);
    await choose("Reset password…");
    return screen.getByRole("form", { name: `Edit ${code}` });
  }

  it("sets a temporary password and shows it once so the admin can tell the employee", async () => {
    listUsersMock.mockResolvedValue({ items: [employee], next_cursor: null });
    resetPasswordMock.mockResolvedValue(undefined);
    renderUsers();
    await screen.findByText("Tran Thi B");

    const form = await openEditor();
    const section = within(form).getByRole("region", {
      name: "Reset password",
    });
    const reset = within(section).getByRole("button", {
      name: "Reset password",
    });
    expect(reset).toBeDisabled();
    await userEvent.type(
      within(section).getByPlaceholderText("Temporary password"),
      "Temp-Pass-1",
    );
    await userEvent.click(reset);

    await waitFor(() =>
      expect(resetPasswordMock).toHaveBeenCalledWith(
        employee.id,
        "Temp-Pass-1",
      ),
    );
    expect(await within(section).findByRole("status")).toHaveTextContent(
      "Temp-Pass-1",
    );
    expect(
      within(section).getByPlaceholderText("Temporary password"),
    ).toHaveValue("");
    // The edit form itself was not saved by accident.
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("Enter in the password box resets it and does not save the form", async () => {
    listUsersMock.mockResolvedValue({ items: [employee], next_cursor: null });
    resetPasswordMock.mockResolvedValue(undefined);
    renderUsers();
    await screen.findByText("Tran Thi B");

    const form = await openEditor();
    await userEvent.type(
      within(form).getByPlaceholderText("Temporary password"),
      "Temp-Pass-1{Enter}",
    );

    await waitFor(() => expect(resetPasswordMock).toHaveBeenCalledTimes(1));
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("Generate fills in a password of a usable length", async () => {
    listUsersMock.mockResolvedValue({ items: [employee], next_cursor: null });
    renderUsers();
    await screen.findByText("Tran Thi B");

    const form = await openEditor();
    await userEvent.click(
      within(form).getByRole("button", { name: "Generate" }),
    );

    const value = (
      within(form).getByPlaceholderText(
        "Temporary password",
      ) as HTMLInputElement
    ).value;
    expect(value.length).toBeGreaterThanOrEqual(8);
    expect(
      within(form).getByRole("button", { name: "Reset password" }),
    ).toBeEnabled();
  });

  it("shows why it failed", async () => {
    listUsersMock.mockResolvedValue({ items: [employee], next_cursor: null });
    resetPasswordMock.mockRejectedValue(
      new ApiError("You do not have permission to do this.", 403),
    );
    renderUsers();
    await screen.findByText("Tran Thi B");

    const form = await openEditor();
    await userEvent.type(
      within(form).getByPlaceholderText("Temporary password"),
      "Temp-Pass-1",
    );
    await userEvent.click(
      within(form).getByRole("button", { name: "Reset password" }),
    );

    expect(await within(form).findByRole("alert")).toHaveTextContent(
      "do not have permission",
    );
  });

  it("is not offered for your own account", async () => {
    const me = sampleUser({
      id: "admin-1",
      employee_code: "ADMIN",
      org_role: "admin",
    });
    fetchMeMock.mockResolvedValue(adminUser);
    listUsersMock.mockResolvedValue({ items: [me], next_cursor: null });
    renderUsers();
    await screen.findByText("You");

    await openMenu("ADMIN");
    await choose("Edit");
    const form = screen.getByRole("form", { name: "Edit ADMIN" });
    expect(
      within(form).queryByRole("region", { name: "Reset password" }),
    ).not.toBeInTheDocument();
    expect(within(form).queryByRole("button", { name: "Reset password…" })).not.toBeInTheDocument();
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

  it("opens with the cursor in the full name", async () => {
    const form = await openNewEmployee();
    expect(screen.getByRole("dialog", { name: "New employee" })).toBeInTheDocument();
    expect(within(form).getByLabelText("Full name")).toHaveFocus();
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
        manager_id: null,
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Employee E002 created.");
    // The form is emptied, so the initial password does not stay on screen, and it is ready
    // for the next employee.
    expect(within(form).getByLabelText("Initial password")).toHaveValue("");
    expect(within(form).getByLabelText("Employee code")).toHaveValue("");
    expect(within(form).getByLabelText("Full name")).toHaveFocus();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("leaving the employee code blank omits it so the server generates one", async () => {
    createUserMock.mockResolvedValue(employee);
    const form = await openNewEmployee();

    await userEvent.type(
      within(form).getByLabelText("Full name"),
      "Nguyen Van B",
    );
    await userEvent.type(
      within(form).getByLabelText("Initial password"),
      "Initial-Pass-1",
    );
    await userEvent.click(
      within(form).getByRole("button", { name: "Add employee" }),
    );

    await waitFor(() => expect(createUserMock).toHaveBeenCalledTimes(1));
    expect(createUserMock.mock.calls[0][0].employee_code).toBeUndefined();
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Employee E002 created.",
    );
  });

  it("the admin level also sends the admin organization role, no department means null", async () => {
    createUserMock.mockResolvedValue(employee);
    const form = await openNewEmployee([]);

    await userEvent.type(within(form).getByLabelText("Employee code"), "BOSS");
    await userEvent.type(within(form).getByLabelText("Full name"), "The Boss");
    await userEvent.type(within(form).getByLabelText("Initial password"), "Initial-Pass-1");
    await userEvent.click(within(form).getByRole("radio", { name: /^Admin/ }));
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

describe("UsersPanel: manager, department filter and account", () => {
  const boss = sampleUser({ id: "u-boss", employee_code: "E010", full_name: "Le Minh Chau" });

  async function openEditor(code = "E002") {
    await openMenu(code);
    await choose("Edit");
    return screen.getByRole("form", { name: `Edit ${code}` });
  }

  it("shows the manager of each employee, and who is on a temporary password", async () => {
    lookupMock.mockResolvedValue([{ id: "u-boss", employee_code: "E010", full_name: "Le Minh Chau" }]);
    listUsersMock.mockResolvedValue({
      items: [{ ...employee, manager_id: "u-boss", must_change_password: true }],
      next_cursor: null,
    });
    renderUsers();
    await screen.findByText("Tran Thi B");

    expect(await within(row("E002")).findByText("Le Minh Chau")).toBeInTheDocument();
    expect(within(row("E002")).getByText("Temporary password")).toBeInTheDocument();
  });

  it("narrows the list to a department chosen in the toolbar", async () => {
    listUsersMock.mockResolvedValue({ items: [employee], next_cursor: null });
    const onDepartmentChange = vi.fn();
    render(
      <AuthProvider>
        <ToastProvider>
          <UsersPanel
            departments={departments}
            departmentId=""
            onDepartmentChange={onDepartmentChange}
            onChanged={vi.fn()}
          />
        </ToastProvider>
      </AuthProvider>,
    );
    await screen.findByText("Tran Thi B");

    const choice = screen.getByLabelText("Department");
    expect(within(choice).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "All departments",
      "Sales",
      "Sales / Team A",
    ]);
    await userEvent.selectOptions(choice, "d-2");
    expect(onDepartmentChange).toHaveBeenCalledWith("d-2");
  });

  it("asks the server for the department the screen has chosen", async () => {
    listUsersMock.mockResolvedValue({ items: [], next_cursor: null });
    render(
      <AuthProvider>
        <UsersPanel
          departments={departments}
          departmentId="d-2"
          onDepartmentChange={vi.fn()}
          onChanged={vi.fn()}
        />
      </AuthProvider>,
    );
    expect(await screen.findByText("No employees match.")).toBeInTheDocument();
    expect(listUsersMock).toHaveBeenLastCalledWith(
      { q: "", status: "", departmentId: "d-2" },
      null,
      expect.anything(),
    );
  });

  it("sets the direct manager and disables the account from the panel, with a warning", async () => {
    searchMock.mockResolvedValue([{ id: "u-boss", employee_code: "E010", full_name: "Le Minh Chau" }]);
    listUsersMock.mockResolvedValue({ items: [employee], next_cursor: null });
    updateUserMock.mockResolvedValue(employee);
    renderUsers();
    await screen.findByText("Tran Thi B");

    const form = await openEditor();
    expect(within(form).getByText("Disabling signs them out everywhere at once.")).toBeInTheDocument();
    await userEvent.type(within(form).getByLabelText("Find an employee for Direct manager"), "le");
    await userEvent.click(await within(form).findByRole("button", { name: "Add Le Minh Chau (E010)" }));
    await userEvent.click(within(form).getByRole("radio", { name: "Disabled" }));
    await userEvent.click(within(form).getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updateUserMock).toHaveBeenCalledWith("u-2", {
        full_name: "Tran Thi B",
        department_id: "d-2",
        manager_id: "u-boss",
        status: "disabled",
      }),
    );
  });

  it("clears the manager with null", async () => {
    lookupMock.mockResolvedValue([{ id: "u-boss", employee_code: "E010", full_name: "Le Minh Chau" }]);
    listUsersMock.mockResolvedValue({ items: [{ ...employee, manager_id: "u-boss" }], next_cursor: null });
    updateUserMock.mockResolvedValue(employee);
    renderUsers();
    await screen.findByText("Tran Thi B");

    const form = await openEditor();
    await userEvent.click(await within(form).findByRole("button", { name: "Remove Le Minh Chau (E010)" }));
    await userEvent.click(within(form).getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updateUserMock).toHaveBeenCalledWith("u-2", {
        full_name: "Tran Thi B",
        department_id: "d-2",
        manager_id: null,
      }),
    );
  });

  it("sends the manager of a new employee", async () => {
    searchMock.mockResolvedValue([{ id: boss.id, employee_code: "E010", full_name: boss.full_name }]);
    createUserMock.mockResolvedValue(employee);
    listUsersMock.mockResolvedValue({ items: [], next_cursor: null });
    renderUsers();
    await screen.findByText("No employees yet.");
    await userEvent.click(screen.getByRole("button", { name: "New employee" }));
    const form = screen.getByRole("form", { name: "Add employee" });

    await userEvent.type(within(form).getByLabelText("Full name"), "Nguyen Van B");
    await userEvent.type(within(form).getByLabelText("Initial password"), "Initial-Pass-1");
    await userEvent.type(within(form).getByLabelText("Find an employee for Direct manager"), "le");
    await userEvent.click(await within(form).findByRole("button", { name: "Add Le Minh Chau (E010)" }));
    await userEvent.click(within(form).getByRole("button", { name: "Add employee" }));

    await waitFor(() =>
      expect(createUserMock).toHaveBeenCalledWith(expect.objectContaining({ manager_id: "u-boss" })),
    );
  });

  it("shows the password as typed when Show is pressed, and Generate shows the new one", async () => {
    listUsersMock.mockResolvedValue({ items: [], next_cursor: null });
    renderUsers();
    await screen.findByText("No employees yet.");
    await userEvent.click(screen.getByRole("button", { name: "New employee" }));
    const form = screen.getByRole("form", { name: "Add employee" });
    const password = within(form).getByLabelText("Initial password");

    expect(password).toHaveAttribute("type", "password");
    await userEvent.click(within(form).getByRole("button", { name: "Show" }));
    expect(password).toHaveAttribute("type", "text");

    await userEvent.click(within(form).getByRole("button", { name: "Hide" }));
    await userEvent.click(within(form).getByRole("button", { name: "Generate" }));
    expect(password).toHaveAttribute("type", "text");
    expect((password as HTMLInputElement).value.length).toBeGreaterThanOrEqual(8);
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
  const onShowPeople = vi.fn();
  const operations: Department = { ...sales, id: "d-4", name: "Operations" };
  /** A team nobody works in, so it may be deleted. */
  const emptyTeam: Department = { ...teamA, member_count: 0 };

  function renderDepartments(items: Department[] = departments) {
    const onChanged = vi.fn();
    render(
      <ToastProvider>
        <DepartmentsPanel departments={items} onChanged={onChanged} onShowPeople={onShowPeople} />
      </ToastProvider>,
    );
    return onChanged;
  }

  function openNewDepartment() {
    return userEvent
      .click(screen.getByRole("button", { name: "New department" }))
      .then(() => screen.getByRole("form", { name: "Add department" }));
  }

  async function openDepartmentMenu(name: string) {
    await userEvent.click(within(row(name)).getByRole("button", { name: `Actions for ${name}` }));
  }

  it("lists a division, then its departments, with the people in each", () => {
    renderDepartments([teamA, sales]);
    const names = screen
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("cell")[0].textContent);
    expect(names).toEqual(["SalesDivision", "Team A"]);

    // A division counts the people of the departments under it.
    const division = within(startRow("Sales")).getAllByRole("cell");
    expect(division[1]).toHaveTextContent("—");
    expect(division[2]).toHaveTextContent("1");
    const team = within(row("Team A")).getAllByRole("cell");
    expect(team[2]).toHaveTextContent("1 →");
  });

  it("shows the head of a department as a person", async () => {
    renderDepartments([sales, { ...teamA, head_user_id: "u-ann" }]);
    expect(await within(row("Team A")).findByText("Ann")).toBeInTheDocument();
  });

  it("opens the people of a department in the Employees tab", async () => {
    renderDepartments();
    await userEvent.click(screen.getByRole("button", { name: "Show the 1 person in Team A" }));
    expect(onShowPeople).toHaveBeenCalledWith("d-2");

    onShowPeople.mockClear();
    await openDepartmentMenu("Team A");
    await userEvent.click(screen.getByRole("menuitem", { name: "Show people" }));
    expect(onShowPeople).toHaveBeenCalledWith("d-2");
  });

  it("folds a division and shows it again", async () => {
    renderDepartments();
    await userEvent.click(screen.getByRole("button", { name: "Collapse Sales" }));
    expect(screen.queryByRole("row", { name: /Team A/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Expand Sales" }));
    expect(row("Team A")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(screen.queryByRole("row", { name: /Team A/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(row("Team A")).toBeInTheDocument();
  });

  describe("editing in the panel", () => {
    async function openEditor(name = "Team A") {
      await userEvent.click(within(row(name)).getByText(name));
      return screen.getByRole("form", { name: `Edit ${name}` });
    }

    it("opens from a click on the row, with the type and the people", async () => {
      listUsersMock.mockResolvedValue({ items: [employee], next_cursor: null });
      renderDepartments();
      const form = await openEditor();

      expect(screen.getByRole("dialog", { name: "Team A" })).toBeInTheDocument();
      expect(within(form).getByText(/The type cannot change/)).toBeInTheDocument();
      expect(await within(form).findByText("Tran Thi B")).toBeInTheDocument();
      expect(listUsersMock).toHaveBeenCalledWith(
        { q: "", status: "", departmentId: "d-2" },
        null,
        expect.anything(),
      );
    });

    it("renames a department and moves it under another division", async () => {
      updateDepartmentMock.mockResolvedValue(teamA);
      listUsersMock.mockResolvedValue({ items: [], next_cursor: null });
      const onChanged = renderDepartments([sales, operations, teamA]);
      const form = await openEditor();

      const name = within(form).getByLabelText("Name");
      await userEvent.clear(name);
      await userEvent.type(name, "  Team Alpha ");
      await userEvent.selectOptions(within(form).getByLabelText("Under division"), "d-4");
      await userEvent.click(within(form).getByRole("button", { name: "Save changes" }));

      await waitFor(() =>
        expect(updateDepartmentMock).toHaveBeenCalledWith("d-2", {
          name: "Team Alpha",
          parent_id: "d-4",
        }),
      );
      expect(onChanged).toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("sends nothing when nothing changed", async () => {
      listUsersMock.mockResolvedValue({ items: [], next_cursor: null });
      renderDepartments();
      const form = await openEditor();
      await userEvent.click(within(form).getByRole("button", { name: "Save changes" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(updateDepartmentMock).not.toHaveBeenCalled();
    });

    it("sets the head by searching for an employee", async () => {
      updateDepartmentMock.mockResolvedValue({ ...teamA, head_user_id: "u-ann" });
      listUsersMock.mockResolvedValue({ items: [], next_cursor: null });
      renderDepartments();
      const form = await openEditor();

      await userEvent.type(within(form).getByLabelText("Find an employee for Head"), "an");
      await userEvent.click(await within(form).findByRole("button", { name: "Add Ann (A1)" }));
      await userEvent.click(within(form).getByRole("button", { name: "Save changes" }));

      await waitFor(() =>
        expect(updateDepartmentMock).toHaveBeenCalledWith("d-2", { head_user_id: "u-ann" }),
      );
    });

    it("takes the head away", async () => {
      updateDepartmentMock.mockResolvedValue({ ...teamA, head_user_id: null });
      listUsersMock.mockResolvedValue({ items: [], next_cursor: null });
      renderDepartments([sales, { ...teamA, head_user_id: "u-ann" }]);
      const form = await openEditor();

      await userEvent.click(await within(form).findByRole("button", { name: "Remove Ann (A1)" }));
      await userEvent.click(within(form).getByRole("button", { name: "Save changes" }));

      await waitFor(() =>
        expect(updateDepartmentMock).toHaveBeenCalledWith("d-2", { head_user_id: null }),
      );
    });

    it("shows the error inside the panel and keeps it open", async () => {
      updateDepartmentMock.mockRejectedValue(
        new ApiError("The head does not exist or is disabled.", 422),
      );
      listUsersMock.mockResolvedValue({ items: [], next_cursor: null });
      const onChanged = renderDepartments();
      const form = await openEditor();

      await userEvent.type(within(form).getByLabelText("Find an employee for Head"), "an");
      await userEvent.click(await within(form).findByRole("button", { name: "Add Ann (A1)" }));
      await userEvent.click(within(form).getByRole("button", { name: "Save changes" }));

      expect(await within(form).findByRole("alert")).toHaveTextContent("does not exist");
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(onChanged).not.toHaveBeenCalled();
    });

    it("has no division to choose for a division", async () => {
      listUsersMock.mockResolvedValue({ items: [], next_cursor: null });
      renderDepartments();
      const form = await openEditor("Sales");
      expect(within(form).queryByLabelText("Under division")).not.toBeInTheDocument();
    });
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
        head_user_id: null,
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
        head_user_id: null,
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
        head_user_id: null,
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
    const onChanged = renderDepartments([sales, emptyTeam]);

    await openDepartmentMenu("Team A");
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete…" }));
    expect(within(row("Team A")).getByText("Delete Team A?")).toBeInTheDocument();
    await userEvent.click(within(row("Team A")).getByRole("button", { name: "Cancel" }));
    expect(deleteDepartmentMock).not.toHaveBeenCalled();

    await openDepartmentMenu("Team A");
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete…" }));
    await userEvent.click(within(row("Team A")).getByRole("button", { name: "Yes, delete" }));
    await waitFor(() => expect(deleteDepartmentMock).toHaveBeenCalledWith("d-2"));
    expect(onChanged).toHaveBeenCalled();
  });

  it("greys out Delete, with the reason, while the department is in use", async () => {
    renderDepartments();

    await openDepartmentMenu("Team A");
    const withPeople = screen.getByRole("menuitem", { name: "Delete…" });
    expect(withPeople).toBeDisabled();
    expect(withPeople).toHaveAttribute("title", "It still has 1 employee.");
    await userEvent.keyboard("{Escape}");

    await userEvent.click(within(startRow("Sales")).getByRole("button", { name: "Actions for Sales" }));
    const withTeams = screen.getByRole("menuitem", { name: "Delete…" });
    expect(withTeams).toBeDisabled();
    expect(withTeams).toHaveAttribute("title", "It still has departments under it.");
  });

  it("shows why a department could not be deleted", async () => {
    deleteDepartmentMock.mockRejectedValue(
      new ApiError("The department still has employees.", 409),
    );
    renderDepartments([sales, emptyTeam]);

    await openDepartmentMenu("Team A");
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete…" }));
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

  it("narrows the Employees tab to a department from the Departments tab", async () => {
    listDepartmentsMock.mockResolvedValue(departments);
    listUsersMock.mockResolvedValue({ items: [employee], next_cursor: null });
    renderScreen();
    await screen.findByText("Tran Thi B");

    await userEvent.click(screen.getByRole("tab", { name: /Departments/ }));
    await userEvent.click(screen.getByRole("button", { name: "Show the 1 person in Team A" }));

    expect(screen.getByRole("tab", { name: /Employees/ })).toHaveAttribute("aria-selected", "true");
    await waitFor(() =>
      expect(listUsersMock).toHaveBeenLastCalledWith(
        { q: "", status: "", departmentId: "d-2" },
        null,
        expect.anything(),
      ),
    );
    expect(screen.getByLabelText("Department")).toHaveValue("d-2");
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
