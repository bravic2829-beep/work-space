import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";
import { adminUser, sampleUser } from "@/test/fixtures";

import { fetchMe, login, logout } from "./api";
import { AuthProvider, useAuth } from "./AuthProvider";
import { LoginForm } from "./LoginForm";
import { LoginScreen } from "./LoginScreen";
import { RequireAdmin } from "./RequireAdmin";
import { RequireAuth } from "./RequireAuth";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("./api", () => ({ fetchMe: vi.fn(), login: vi.fn(), logout: vi.fn() }));

const fetchMeMock = vi.mocked(fetchMe);
const loginMock = vi.mocked(login);
const logoutMock = vi.mocked(logout);

beforeEach(() => {
  vi.resetAllMocks();
});

function Probe() {
  const { state, logout: doLogout } = useAuth();
  return (
    <div>
      <p data-testid="state">
        {state.status === "authenticated" ? `in:${state.user.full_name}` : state.status}
      </p>
      <button type="button" onClick={() => void doLogout().catch(() => undefined)}>
        out
      </button>
    </div>
  );
}

function renderProbe() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

describe("AuthProvider", () => {
  it("starts loading, then knows the signed-in user", async () => {
    fetchMeMock.mockResolvedValue(sampleUser({ full_name: "Mai" }));
    renderProbe();
    expect(screen.getByTestId("state")).toHaveTextContent("loading");
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("in:Mai"));
  });

  it("treats a 401 as signed out", async () => {
    fetchMeMock.mockRejectedValue(new ApiError("Authentication is required.", 401));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("anonymous"));
  });

  it("reports other failures as an error, not as signed out", async () => {
    fetchMeMock.mockRejectedValue(new ApiError("Network error"));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("error"));
  });

  it("signs out through the API and forgets the user", async () => {
    fetchMeMock.mockResolvedValue(sampleUser());
    logoutMock.mockResolvedValue(undefined);
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("in:"));

    await userEvent.click(screen.getByRole("button", { name: "out" }));

    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("anonymous"));
    expect(logoutMock).toHaveBeenCalledTimes(1);
  });

  it("still signs out locally when the session was already gone (401)", async () => {
    fetchMeMock.mockResolvedValue(sampleUser());
    logoutMock.mockRejectedValue(new ApiError("Authentication is required.", 401));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("in:"));

    await userEvent.click(screen.getByRole("button", { name: "out" }));

    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("anonymous"));
  });

  it("stays signed in when signing out fails for another reason", async () => {
    fetchMeMock.mockResolvedValue(sampleUser());
    logoutMock.mockRejectedValue(new ApiError("Network error"));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("in:"));

    await userEvent.click(screen.getByRole("button", { name: "out" }));

    await waitFor(() => expect(logoutMock).toHaveBeenCalled());
    expect(screen.getByTestId("state")).toHaveTextContent("in:");
  });

  it("refuses to be used outside the provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow("useAuth must be used inside <AuthProvider>");
    spy.mockRestore();
  });
});

describe("LoginForm", () => {
  function renderForm() {
    fetchMeMock.mockRejectedValue(new ApiError("Authentication is required.", 401));
    return render(
      <AuthProvider>
        <LoginForm />
      </AuthProvider>,
    );
  }

  async function fill(code: string, password: string) {
    await userEvent.type(screen.getByLabelText("Employee code"), code);
    await userEvent.type(screen.getByLabelText("Password"), password);
  }

  it("signs in with the typed values and goes to the home page", async () => {
    loginMock.mockResolvedValue(sampleUser());
    renderForm();

    await fill("  E001 ", "secret-pass");
    await userEvent.click(screen.getByLabelText("Remember me for 7 days"));
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    expect(loginMock).toHaveBeenCalledWith("E001", "secret-pass", true);
  });

  it("does not remember the user unless asked", async () => {
    loginMock.mockResolvedValue(sampleUser());
    renderForm();
    await fill("E001", "secret-pass");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(loginMock).toHaveBeenCalledWith("E001", "secret-pass", false));
  });

  it("shows the error, clears the password and lets the user retry", async () => {
    loginMock.mockRejectedValue(new ApiError("Invalid employee code or password.", 401));
    renderForm();

    await fill("E001", "wrong-pass");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid employee code or password.");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByLabelText("Employee code")).toHaveValue("E001");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("tells the user how long to wait after too many attempts", async () => {
    loginMock.mockRejectedValue(new ApiError("Too many failed login attempts.", 429, [], 240));
    renderForm();
    await fill("E001", "x");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Try again in 4 minute(s).");
  });

  it("disables the button while the request is running", async () => {
    let finish: (user: ReturnType<typeof sampleUser>) => void = () => undefined;
    loginMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderForm();
    await fill("E001", "secret-pass");

    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(screen.getByRole("button", { name: "Signing in…" })).toBeDisabled();
    finish(sampleUser());
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
  });

  it("does not leak the password into the page", async () => {
    renderForm();
    await fill("E001", "secret-pass");
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(document.body.textContent).not.toContain("secret-pass");
  });
});

describe("RequireAuth", () => {
  function renderGuard() {
    return render(
      <AuthProvider>
        <RequireAuth>
          <p>secret page</p>
        </RequireAuth>
      </AuthProvider>,
    );
  }

  it("shows a loading message and hides the page while checking", () => {
    fetchMeMock.mockReturnValue(new Promise(() => undefined));
    renderGuard();
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(screen.queryByText("secret page")).not.toBeInTheDocument();
  });

  it("sends an anonymous visitor to the sign-in page and never shows the page", async () => {
    fetchMeMock.mockRejectedValue(new ApiError("Authentication is required.", 401));
    renderGuard();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
    expect(screen.queryByText("secret page")).not.toBeInTheDocument();
  });

  it("shows the page to a signed-in user", async () => {
    fetchMeMock.mockResolvedValue(sampleUser());
    renderGuard();
    expect(await screen.findByText("secret page")).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("reports a backend problem without redirecting", async () => {
    fetchMeMock.mockRejectedValue(new ApiError("Network error"));
    renderGuard();
    expect(await screen.findByRole("alert")).toHaveTextContent("Network error");
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe("RequireAdmin", () => {
  function renderAdminGuard() {
    return render(
      <AuthProvider>
        <RequireAdmin>
          <p>admin page</p>
        </RequireAdmin>
      </AuthProvider>,
    );
  }

  it("hides the page from employees", async () => {
    fetchMeMock.mockResolvedValue(sampleUser());
    renderAdminGuard();
    expect(await screen.findByRole("alert")).toHaveTextContent("do not have access");
    expect(screen.queryByText("admin page")).not.toBeInTheDocument();
  });

  it("hides the page from managers who are not organization admins", async () => {
    fetchMeMock.mockResolvedValue(sampleUser({ level: "department_manager" }));
    renderAdminGuard();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("admin page")).not.toBeInTheDocument();
  });

  it.each([adminUser, sampleUser({ org_role: "owner", level: "admin" })])(
    "shows the page to admins and owners",
    async (user) => {
      fetchMeMock.mockResolvedValue(user);
      renderAdminGuard();
      expect(await screen.findByText("admin page")).toBeInTheDocument();
    },
  );
});

describe("LoginScreen", () => {
  it("shows the form to an anonymous visitor", async () => {
    fetchMeMock.mockRejectedValue(new ApiError("Authentication is required.", 401));
    render(
      <AuthProvider>
        <LoginScreen />
      </AuthProvider>,
    );
    expect(await screen.findByRole("form", { name: "Sign in" })).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("sends someone who is already signed in to the home page", async () => {
    fetchMeMock.mockResolvedValue(sampleUser());
    render(
      <AuthProvider>
        <LoginScreen />
      </AuthProvider>,
    );
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
  });
});
