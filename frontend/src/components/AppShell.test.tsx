import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";
import { fetchMe, logout } from "@/features/auth/api";
import { AuthProvider } from "@/features/auth/AuthProvider";
import { adminUser, sampleUser } from "@/test/fixtures";

import { AppShell } from "./AppShell";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/features/auth/api", () => ({ fetchMe: vi.fn(), login: vi.fn(), logout: vi.fn() }));

const fetchMeMock = vi.mocked(fetchMe);
const logoutMock = vi.mocked(logout);

beforeEach(() => {
  vi.resetAllMocks();
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

describe("AppShell", () => {
  it("shows the user, the page and the HR link to an admin", async () => {
    fetchMeMock.mockResolvedValue(adminUser);
    renderShell();
    expect(await screen.findByText("page content")).toBeInTheDocument();
    expect(screen.getByText(/Admin User \(ADMIN\)/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Human resources" })).toHaveAttribute("href", "/hr");
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
