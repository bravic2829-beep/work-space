import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchMe } from "@/features/auth/api";
import { AuthProvider } from "@/features/auth/AuthProvider";
import { ApiError } from "@/lib/api/client";
import { adminUser, sampleUser } from "@/test/fixtures";

import {
  createDepartment,
  createUser,
  deleteDepartment,
  listDepartments,
  listUsers,
  updateUser,
} from "./api";
import { DepartmentsPanel } from "./DepartmentsPanel";
import { HrScreen } from "./HrScreen";
import type { Department } from "./schema";
import { UsersPanel } from "./UsersPanel";

vi.mock("@/features/auth/api", () => ({ fetchMe: vi.fn(), login: vi.fn(), logout: vi.fn() }));
vi.mock("./api", () => ({
  listUsers: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  listDepartments: vi.fn(),
  createDepartment: vi.fn(),
  deleteDepartment: vi.fn(),
}));

const fetchMeMock = vi.mocked(fetchMe);
const listUsersMock = vi.mocked(listUsers);
const createUserMock = vi.mocked(createUser);
const updateUserMock = vi.mocked(updateUser);
const listDepartmentsMock = vi.mocked(listDepartments);
const createDepartmentMock = vi.mocked(createDepartment);
const deleteDepartmentMock = vi.mocked(deleteDepartment);

const sales: Department = { id: "d-1", name: "Sales", kind: "division", parent_id: null };
const teamA: Department = { id: "d-2", name: "Team A", kind: "department", parent_id: "d-1" };
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

describe("UsersPanel: listing", () => {
  it("shows a loading state, then the employees with their department names", async () => {
    listUsersMock.mockResolvedValue({ items: [employee], next_cursor: null });
    renderUsers();
    expect(screen.getByRole("status")).toHaveTextContent("Loading employees");

    expect(await screen.findByText("Tran Thi B")).toBeInTheDocument();
    const cells = within(row("E002")).getAllByRole("cell");
    expect(cells.map((cell) => cell.textContent)).toEqual([
      "E002",
      "Tran Thi B",
      "Employee",
      "Team A",
      "Active",
      expect.any(String),
    ]);
  });

  it("says so when nobody matches", async () => {
    listUsersMock.mockResolvedValue({ items: [], next_cursor: null });
    renderUsers();
    expect(await screen.findByText("No employees match.")).toBeInTheDocument();
  });

  it("shows the error when loading fails", async () => {
    listUsersMock.mockRejectedValue(new ApiError("You do not have permission to do this.", 403));
    renderUsers();
    expect(await screen.findByRole("alert")).toHaveTextContent("do not have permission");
  });

  it("searches with the typed text and the chosen status", async () => {
    listUsersMock.mockResolvedValue({ items: [], next_cursor: null });
    renderUsers();
    await screen.findByText("No employees match.");

    await userEvent.type(screen.getByLabelText("Search"), "  mai ");
    await userEvent.selectOptions(screen.getByLabelText("Status"), "disabled");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() =>
      expect(listUsersMock).toHaveBeenLastCalledWith(
        { q: "mai", status: "disabled" },
        null,
        expect.anything(),
      ),
    );
  });

  it("loads the next page with the cursor and appends it", async () => {
    listUsersMock.mockResolvedValueOnce({ items: [employee], next_cursor: "CURSOR1" });
    renderUsers();
    await screen.findByText("Tran Thi B");

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
    listUsersMock.mockResolvedValueOnce({ items: [employee], next_cursor: "CURSOR1" });
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

    expect(within(row("OWNER")).queryByRole("button")).not.toBeInTheDocument();
    // The signed-in admin may edit their own row but not disable it.
    const own = within(row("ADMIN"));
    expect(own.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(own.queryByRole("button", { name: "Disable" })).not.toBeInTheDocument();
    expect(within(row("E002")).getByRole("button", { name: "Disable" })).toBeInTheDocument();
  });

  it("disables an employee and reloads the list", async () => {
    listUsersMock.mockResolvedValue({ items: [employee], next_cursor: null });
    updateUserMock.mockResolvedValue({ ...employee, status: "disabled" });
    renderUsers();
    await screen.findByText("Tran Thi B");

    listUsersMock.mockResolvedValue({
      items: [{ ...employee, status: "disabled" }],
      next_cursor: null,
    });
    await userEvent.click(within(row("E002")).getByRole("button", { name: "Disable" }));

    await waitFor(() => expect(updateUserMock).toHaveBeenCalledWith("u-2", { status: "disabled" }));
    // "Disabled" is also an option of the status filter, so look inside the employee's row.
    expect(await within(await screen.findByRole("row", { name: /E002/ })).findByText("Disabled")).toBeInTheDocument();
    expect(within(row("E002")).getByRole("button", { name: "Enable" })).toBeInTheDocument();
  });

  it("shows the server's refusal and keeps the row", async () => {
    listUsersMock.mockResolvedValue({ items: [employee], next_cursor: null });
    updateUserMock.mockRejectedValue(new ApiError("The owner account cannot be changed.", 403));
    renderUsers();
    await screen.findByText("Tran Thi B");

    await userEvent.click(within(row("E002")).getByRole("button", { name: "Disable" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("cannot be changed");
    expect(screen.getByText("Tran Thi B")).toBeInTheDocument();
  });

  it("edits the name, department and level of an employee", async () => {
    listUsersMock.mockResolvedValue({ items: [employee], next_cursor: null });
    updateUserMock.mockResolvedValue(employee);
    renderUsers();
    await screen.findByText("Tran Thi B");

    await userEvent.click(within(row("E002")).getByRole("button", { name: "Edit" }));
    const form = screen.getByRole("form", { name: "Edit E002" });
    const name = within(form).getByLabelText("Full name");
    await userEvent.clear(name);
    await userEvent.type(name, "  Tran Thi Bich ");
    await userEvent.selectOptions(within(form).getByLabelText("Level"), "department_manager");
    await userEvent.selectOptions(within(form).getByLabelText("Department"), "d-1");
    await userEvent.click(within(form).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateUserMock).toHaveBeenCalledWith("u-2", {
        full_name: "Tran Thi Bich",
        department_id: "d-1",
        level: "department_manager",
        org_role: "member",
      }),
    );
  });

  it("promoting to the admin level also sends the admin organization role", async () => {
    listUsersMock.mockResolvedValue({ items: [employee], next_cursor: null });
    updateUserMock.mockResolvedValue(employee);
    renderUsers();
    await screen.findByText("Tran Thi B");

    await userEvent.click(within(row("E002")).getByRole("button", { name: "Edit" }));
    const form = screen.getByRole("form", { name: "Edit E002" });
    await userEvent.selectOptions(within(form).getByLabelText("Level"), "admin");
    await userEvent.click(within(form).getByRole("button", { name: "Save" }));

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
    await screen.findByText("Admin User");

    await userEvent.click(within(row("ADMIN")).getByRole("button", { name: "Edit" }));
    const form = screen.getByRole("form", { name: "Edit ADMIN" });
    expect(within(form).getByLabelText("Level")).toBeDisabled();
    await userEvent.selectOptions(within(form).getByLabelText("Department"), "");
    await userEvent.click(within(form).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateUserMock).toHaveBeenCalledWith("admin-1", {
        full_name: "Admin User",
        department_id: null,
      }),
    );
  });

  it("cancel closes the editor without saving", async () => {
    listUsersMock.mockResolvedValue({ items: [employee], next_cursor: null });
    renderUsers();
    await screen.findByText("Tran Thi B");

    await userEvent.click(within(row("E002")).getByRole("button", { name: "Edit" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("form", { name: "Edit E002" })).not.toBeInTheDocument();
    expect(updateUserMock).not.toHaveBeenCalled();
  });
});

describe("Add employee form", () => {
  async function renderWithEmptyList(deps: Department[] = departments) {
    listUsersMock.mockResolvedValue({ items: [], next_cursor: null });
    renderUsers(deps);
    await screen.findByText("No employees match.");
    return screen.getByRole("form", { name: "Add employee" });
  }

  it("creates an employee with a normal level as a member", async () => {
    createUserMock.mockResolvedValue(employee);
    const form = await renderWithEmptyList();

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
    // The form is emptied, so the initial password does not stay on screen.
    expect(within(form).getByLabelText("Initial password")).toHaveValue("");
    expect(within(form).getByLabelText("Employee code")).toHaveValue("");
  });

  it("the admin level also sends the admin organization role, no department means null", async () => {
    createUserMock.mockResolvedValue(employee);
    const form = await renderWithEmptyList([]);

    await userEvent.type(within(form).getByLabelText("Employee code"), "BOSS");
    await userEvent.type(within(form).getByLabelText("Full name"), "The Boss");
    await userEvent.type(within(form).getByLabelText("Initial password"), "Initial-Pass-1");
    await userEvent.selectOptions(within(form).getByLabelText("Level"), "admin");
    await userEvent.click(within(form).getByRole("button", { name: "Add employee" }));

    await waitFor(() =>
      expect(createUserMock).toHaveBeenCalledWith(
        expect.objectContaining({ level: "admin", org_role: "admin", department_id: null }),
      ),
    );
  });

  it("shows a conflict and keeps what was typed", async () => {
    createUserMock.mockRejectedValue(new ApiError("This employee code is already in use.", 409));
    const form = await renderWithEmptyList();

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
    const form = await renderWithEmptyList();

    await userEvent.type(within(form).getByLabelText("Employee code"), "NV100");
    await userEvent.type(within(form).getByLabelText("Full name"), "Nguyen Van B");
    await userEvent.type(within(form).getByLabelText("Initial password"), "Initial-Pass-1");
    await userEvent.click(within(form).getByRole("button", { name: "Add employee" }));

    expect(await within(form).findByText(/department_id: The department does not exist/)).toBeInTheDocument();
  });
});

describe("DepartmentsPanel", () => {
  function renderDepartments(items: Department[] = departments) {
    const onChanged = vi.fn();
    render(<DepartmentsPanel departments={items} onChanged={onChanged} />);
    return onChanged;
  }

  it("lists departments with their kind and parent", () => {
    renderDepartments();
    const cells = within(row("Team A")).getAllByRole("cell");
    expect(cells.map((cell) => cell.textContent)).toEqual([
      "Team A",
      "Department",
      "Sales",
      expect.any(String),
    ]);
  });

  it("says so when there are none", () => {
    renderDepartments([]);
    expect(screen.getByText("No departments yet.")).toBeInTheDocument();
  });

  it("creates a division without a parent", async () => {
    createDepartmentMock.mockResolvedValue(sales);
    const onChanged = renderDepartments();

    const form = screen.getByRole("form", { name: "Add department" });
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
  });

  it("creates a department under a division chosen from divisions only", async () => {
    createDepartmentMock.mockResolvedValue(teamA);
    renderDepartments();

    const form = screen.getByRole("form", { name: "Add department" });
    await userEvent.selectOptions(within(form).getByLabelText("Type"), "department");
    const parent = within(form).getByLabelText("Under division");
    expect(within(parent).getAllByRole("option").map((o) => o.textContent)).toEqual(["None", "Sales"]);
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
  });

  it("shows the server's refusal (duplicate name)", async () => {
    createDepartmentMock.mockRejectedValue(
      new ApiError("A department with this name already exists here.", 409),
    );
    const onChanged = renderDepartments();
    const form = screen.getByRole("form", { name: "Add department" });
    await userEvent.type(within(form).getByLabelText("Name"), "Sales");
    await userEvent.click(within(form).getByRole("button", { name: "Add department" }));

    expect(await within(form).findByRole("alert")).toHaveTextContent("already exists");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("deletes only after the user confirms", async () => {
    deleteDepartmentMock.mockResolvedValue(undefined);
    const confirm = vi.spyOn(window, "confirm");
    const onChanged = renderDepartments();

    confirm.mockReturnValueOnce(false);
    await userEvent.click(within(row("Team A")).getByRole("button", { name: "Delete" }));
    expect(deleteDepartmentMock).not.toHaveBeenCalled();

    confirm.mockReturnValueOnce(true);
    await userEvent.click(within(row("Team A")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteDepartmentMock).toHaveBeenCalledWith("d-2"));
    expect(onChanged).toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("shows why a department could not be deleted", async () => {
    deleteDepartmentMock.mockRejectedValue(
      new ApiError("The department still has employees.", 409),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderDepartments();

    await userEvent.click(within(row("Team A")).getByRole("button", { name: "Delete" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("still has employees");
  });
});

describe("HrScreen", () => {
  it("loads the departments, then shows both panels", async () => {
    listDepartmentsMock.mockResolvedValue(departments);
    listUsersMock.mockResolvedValue({ items: [employee], next_cursor: null });
    render(
      <AuthProvider>
        <HrScreen />
      </AuthProvider>,
    );

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Departments" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Employees" })).toBeInTheDocument();
    expect(await screen.findByText("Tran Thi B")).toBeInTheDocument();
  });

  it("shows an error, and no employee data, when departments cannot be loaded", async () => {
    listDepartmentsMock.mockRejectedValue(new ApiError("You do not have permission to do this.", 403));
    render(
      <AuthProvider>
        <HrScreen />
      </AuthProvider>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("do not have permission");
    expect(listUsersMock).not.toHaveBeenCalled();
  });
});
