import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchMe } from "@/features/auth/api";
import { AuthProvider } from "@/features/auth/AuthProvider";
import { ApiError } from "@/lib/api/client";
import { adminUser, sampleUser } from "@/test/fixtures";

import {
  createBase,
  createTable,
  createWorkspace,
  getWorkspace,
  listBases,
  listMembers,
  listTables,
  listWorkspaces,
} from "./api";
import { makeTable, makeWorkspace } from "./fixtures";
import { WorkspaceScreen } from "./WorkspaceScreen";
import { WorkspacesScreen } from "./WorkspacesScreen";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/features/auth/api", () => ({ fetchMe: vi.fn(), login: vi.fn(), logout: vi.fn() }));
vi.mock("./api", () => ({
  listWorkspaces: vi.fn(),
  createWorkspace: vi.fn(),
  getWorkspace: vi.fn(),
  listBases: vi.fn(),
  createBase: vi.fn(),
  listTables: vi.fn(),
  createTable: vi.fn(),
  listMembers: vi.fn(),
  searchDirectory: vi.fn(),
}));

const fetchMeMock = vi.mocked(fetchMe);
const listWorkspacesMock = vi.mocked(listWorkspaces);
const createWorkspaceMock = vi.mocked(createWorkspace);
const getWorkspaceMock = vi.mocked(getWorkspace);
const listBasesMock = vi.mocked(listBases);
const createBaseMock = vi.mocked(createBase);
const listTablesMock = vi.mocked(listTables);
const createTableMock = vi.mocked(createTable);

const shared = makeWorkspace("w-1", "Projects", "editor");
const personal = makeWorkspace("w-2", "Personal", "admin", "personal");

beforeEach(() => {
  vi.resetAllMocks();
  fetchMeMock.mockResolvedValue(sampleUser());
  listWorkspacesMock.mockResolvedValue([personal, shared]);
  vi.mocked(listMembers).mockResolvedValue([]);
});

function renderWorkspaces() {
  return render(
    <AuthProvider>
      <WorkspacesScreen />
    </AuthProvider>,
  );
}

describe("workspaces list", () => {
  it("lists the workspaces with their kind and the person's role, as links", async () => {
    renderWorkspaces();
    const link = await screen.findByRole("link", { name: "Projects" });
    expect(link).toHaveAttribute("href", "/workspaces/w-1");
    expect(screen.getByRole("link", { name: "Personal" })).toHaveAttribute("href", "/workspaces/w-2");
    expect(screen.getByText(/shared · editor/)).toBeInTheDocument();
    expect(screen.getByText(/personal · admin/)).toBeInTheDocument();
  });

  it("does not offer to create a workspace to an ordinary employee", async () => {
    renderWorkspaces();
    await screen.findByRole("link", { name: "Projects" });
    await waitFor(() => expect(fetchMeMock).toHaveBeenCalled());
    expect(screen.queryByRole("form", { name: "New workspace" })).not.toBeInTheDocument();
  });

  it("lets an admin create one and shows the new list", async () => {
    const user = userEvent.setup();
    fetchMeMock.mockResolvedValue(adminUser);
    createWorkspaceMock.mockResolvedValue(makeWorkspace("w-3", "Sales", "admin"));
    renderWorkspaces();
    await user.type(await screen.findByLabelText("Workspace name"), "  Sales ");
    await user.click(screen.getByRole("button", { name: "Create workspace" }));
    await waitFor(() => expect(createWorkspaceMock).toHaveBeenCalledWith("Sales"));
    await waitFor(() => expect(listWorkspacesMock).toHaveBeenCalledTimes(2));
  });

  it("shows why a workspace could not be created", async () => {
    const user = userEvent.setup();
    fetchMeMock.mockResolvedValue(adminUser);
    createWorkspaceMock.mockRejectedValue(new ApiError("You do not have permission to do this.", 403));
    renderWorkspaces();
    await user.type(await screen.findByLabelText("Workspace name"), "Sales");
    await user.click(screen.getByRole("button", { name: "Create workspace" }));
    expect(await screen.findByText("You do not have permission to do this.")).toBeInTheDocument();
  });

  it("says so when the person is in no workspace", async () => {
    listWorkspacesMock.mockResolvedValue([]);
    renderWorkspaces();
    expect(await screen.findByText("You are not in any workspace yet.")).toBeInTheDocument();
  });

  it("explains a failure and tries again", async () => {
    const user = userEvent.setup();
    listWorkspacesMock.mockRejectedValueOnce(new ApiError("The database is not configured.", 503));
    renderWorkspaces();
    expect(await screen.findByText(/database is not configured/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: "Projects" })).toBeInTheDocument();
  });
});

describe("one workspace", () => {
  const base = { id: "b-1", workspace_id: "w-1", name: "Sales base" };

  beforeEach(() => {
    getWorkspaceMock.mockResolvedValue(shared);
    listBasesMock.mockResolvedValue([base]);
    listTablesMock.mockResolvedValue([{ id: "t-1", base_id: "b-1", name: "Tasks" }]);
  });

  function renderWorkspace() {
    return render(
      <AuthProvider>
        <WorkspaceScreen workspaceId="w-1" />
      </AuthProvider>,
    );
  }

  it("shows its bases and links to the tables", async () => {
    renderWorkspace();
    expect(await screen.findByRole("heading", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sales base" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tasks" })).toHaveAttribute("href", "/tables/t-1");
  });

  it("says when there is nothing yet", async () => {
    listBasesMock.mockResolvedValue([]);
    renderWorkspace();
    expect(await screen.findByText("No bases yet.")).toBeInTheDocument();
  });

  it("says when a base has no tables", async () => {
    listTablesMock.mockResolvedValue([]);
    renderWorkspace();
    expect(await screen.findByText("No tables yet.")).toBeInTheDocument();
  });

  it("lets an editor add a base", async () => {
    const user = userEvent.setup();
    createBaseMock.mockResolvedValue({ id: "b-2", workspace_id: "w-1", name: "HR" });
    renderWorkspace();
    await user.type(await screen.findByLabelText("Base name"), "HR");
    await user.click(screen.getByRole("button", { name: "Add base" }));
    await waitFor(() => expect(createBaseMock).toHaveBeenCalledWith("w-1", "HR"));
    await waitFor(() => expect(listBasesMock).toHaveBeenCalledTimes(2));
  });

  it("lets an editor add a table from a template", async () => {
    const user = userEvent.setup();
    createTableMock.mockResolvedValue(makeTable());
    renderWorkspace();
    await user.type(await screen.findByLabelText("Table name in Sales base"), "Sprint");
    await user.selectOptions(screen.getByLabelText("Template for the table in Sales base"), "tasks");
    await user.click(screen.getByRole("button", { name: "Add table" }));
    await waitFor(() => expect(createTableMock).toHaveBeenCalledWith("b-1", "Sprint", "tasks"));
  });

  it("makes a blank table by default", async () => {
    const user = userEvent.setup();
    createTableMock.mockResolvedValue(makeTable());
    renderWorkspace();
    await user.type(await screen.findByLabelText("Table name in Sales base"), "Notes");
    await user.click(screen.getByRole("button", { name: "Add table" }));
    await waitFor(() => expect(createTableMock).toHaveBeenCalledWith("b-1", "Notes", "blank"));
  });

  it("shows the server's reason when a name is taken", async () => {
    const user = userEvent.setup();
    createBaseMock.mockRejectedValue(new ApiError("A base with this name already exists.", 409));
    renderWorkspace();
    await user.type(await screen.findByLabelText("Base name"), "Sales base");
    await user.click(screen.getByRole("button", { name: "Add base" }));
    expect(await screen.findByText("A base with this name already exists.")).toBeInTheDocument();
  });

  it("offers no forms to a viewer", async () => {
    getWorkspaceMock.mockResolvedValue(makeWorkspace("w-1", "Projects", "viewer"));
    renderWorkspace();
    await screen.findByRole("heading", { name: "Sales base" });
    expect(screen.queryByLabelText("Base name")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add table" })).not.toBeInTheDocument();
  });

  it("explains a refusal and a missing workspace", async () => {
    getWorkspaceMock.mockRejectedValue(new ApiError("Forbidden", 403));
    const { unmount } = renderWorkspace();
    expect(await screen.findByText(/do not have access to this workspace/)).toBeInTheDocument();
    unmount();

    getWorkspaceMock.mockRejectedValue(new ApiError("Not found", 404));
    renderWorkspace();
    expect(await screen.findByText("This workspace does not exist.")).toBeInTheDocument();
  });
});
