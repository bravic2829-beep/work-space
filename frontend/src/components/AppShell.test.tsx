import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";
import { fetchMe, logout } from "@/features/auth/api";
import { AuthProvider } from "@/features/auth/AuthProvider";
import { listSheets } from "@/features/sheets/api";
import { listWorkspaces } from "@/features/tables/api";
import { getUnreadCount } from "@/features/notifications/api";
import { adminUser, sampleUser } from "@/test/fixtures";

import { AppShell } from "./AppShell";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/my-tasks" }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/features/auth/api", () => ({ fetchMe: vi.fn(), login: vi.fn(), logout: vi.fn() }));

vi.mock("@/features/notifications/api", () => ({
  getUnreadCount: vi.fn(),
  listNotifications: vi.fn(),
  setNotificationRead: vi.fn(),
}));

vi.mock("@/features/tables/api", () => ({
  listWorkspaces: vi.fn(),
  listBases: vi.fn(),
  listTables: vi.fn(),
}));
vi.mock("@/features/sheets/api", () => ({ listSheets: vi.fn() }));

const fetchMeMock = vi.mocked(fetchMe);
const logoutMock = vi.mocked(logout);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getUnreadCount).mockResolvedValue(0);
  vi.mocked(listWorkspaces).mockResolvedValue([]);
  vi.mocked(listSheets).mockResolvedValue([]);
  // The bell opens a WebSocket; in these tests nobody is listening on the other end.
  vi.stubGlobal(
    "WebSocket",
    class {
      close() {}
    },
  );
});

function renderShell() {
  return render(
    <AuthProvider>
      <AppShell>
        <p>page content</p>
      </AppShell>
    </AuthProvider>,
  );
}

describe("AppShell with a temporary password", () => {
  it("shows only the change-password form until the password is changed", async () => {
    fetchMeMock.mockResolvedValue(sampleUser({ must_change_password: true }));
    renderShell();

    expect(
      await screen.findByRole("heading", { name: "Choose a new password" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("page content")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("complementary", { name: "Sidebar" }),
    ).not.toBeInTheDocument();
  });
});

describe("AppShell", () => {
  it("shows the user, the page and the HR link to an admin", async () => {
    fetchMeMock.mockResolvedValue(adminUser);
    renderShell();
    expect(await screen.findByText("page content")).toBeInTheDocument();
    expect(screen.getByText("Admin User")).toBeInTheDocument();
    expect(screen.getByText("ADMIN")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Human resources" })).toHaveAttribute("href", "/hr");
  });

  it("puts the navigation in a sidebar and names the current section in the breadcrumb", async () => {
    fetchMeMock.mockResolvedValue(sampleUser());
    renderShell();
    await screen.findByText("page content");

    const sidebar = screen.getByRole("complementary", { name: "Sidebar" });
    expect(within(sidebar).getByRole("navigation", { name: "Main" })).toBeInTheDocument();
    // The mocked path is /my-tasks.
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).getByText("My tasks")).toHaveAttribute("aria-current", "page");
    // Which link is highlighted is covered by NavLink.test.tsx (the Link mock here drops props).
    expect(within(sidebar).getByRole("link", { name: "My tasks" })).toBeInTheDocument();
  });

  it("opens the menu with the menu button, and closes it after choosing a page", async () => {
    fetchMeMock.mockResolvedValue(sampleUser());
    renderShell();
    await screen.findByText("page content");

    const button = screen.getByRole("button", { name: "Open menu" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");

    await userEvent.click(screen.getByRole("link", { name: "Trash" }));
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("collapses the sidebar to icons and remembers the choice", async () => {
    window.localStorage.clear();
    fetchMeMock.mockResolvedValue(sampleUser());
    const first = renderShell();
    await screen.findByText("page content");

    const sidebar = screen.getByRole("complementary", { name: "Sidebar" });
    expect(sidebar).toHaveClass("md:w-60");
    await userEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(sidebar).toHaveClass("md:w-16");
    // The links keep their names for screen readers and show them as a tooltip.
    expect(within(sidebar).getByRole("link", { name: "My tasks" })).toBeInTheDocument();
    expect(window.localStorage.getItem("workbase.sidebar.collapsed")).toBe("1");

    // A later visit starts collapsed, and one click opens it again.
    first.unmount();
    renderShell();
    await screen.findByText("page content");
    const again = screen.getByRole("complementary", { name: "Sidebar" });
    expect(again).toHaveClass("md:w-16");
    await userEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(again).toHaveClass("md:w-60");
    window.localStorage.clear();
  });

  it("hides the HR link from an employee", async () => {
    fetchMeMock.mockResolvedValue(sampleUser());
    renderShell();
    expect(await screen.findByText("page content")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Human resources" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
  });

  it("renders nothing while nobody is signed in", async () => {
    fetchMeMock.mockRejectedValue(new ApiError("Authentication is required.", 401));
    renderShell();
    await waitFor(() => expect(fetchMeMock).toHaveBeenCalled());
    expect(screen.queryByText("page content")).not.toBeInTheDocument();
  });

  it("signs out and goes to the sign-in page", async () => {
    fetchMeMock.mockResolvedValue(sampleUser());
    logoutMock.mockResolvedValue(undefined);
    renderShell();

    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
  });

  it("shows an error and stays when signing out fails", async () => {
    fetchMeMock.mockResolvedValue(sampleUser());
    logoutMock.mockRejectedValue(new ApiError("Network error"));
    renderShell();

    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not sign out");
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
  });
});
