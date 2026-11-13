import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import { fetchHealth, fetchReady } from "./api";
import { HealthStatus } from "./HealthStatus";

vi.mock("./api", () => ({ fetchHealth: vi.fn(), fetchReady: vi.fn() }));

const fetchHealthMock = vi.mocked(fetchHealth);
const fetchReadyMock = vi.mocked(fetchReady);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("HealthStatus", () => {
  it("shows a loading state first", () => {
    fetchHealthMock.mockReturnValue(new Promise(() => {}));
    render(<HealthStatus />);
    expect(screen.getByRole("status")).toHaveTextContent("Checking the backend");
  });

  it("shows API and database as ok", async () => {
    fetchHealthMock.mockResolvedValue({ status: "ok" });
    fetchReadyMock.mockResolvedValue({ status: "ok", database: "ok" });
    render(<HealthStatus />);
    expect(await screen.findByText("API: ok")).toBeInTheDocument();
    expect(screen.getByText("Database: ok")).toBeInTheDocument();
  });

  it("shows the database as unavailable when readiness says so", async () => {
    fetchHealthMock.mockResolvedValue({ status: "ok" });
    fetchReadyMock.mockResolvedValue({ status: "unavailable", database: "error" });
    render(<HealthStatus />);
    expect(await screen.findByText("Database: unavailable")).toBeInTheDocument();
  });

  it("shows an error with a working retry button", async () => {
    fetchHealthMock.mockRejectedValueOnce(new ApiError("Network error"));
    render(<HealthStatus />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Network error");

    fetchHealthMock.mockResolvedValue({ status: "ok" });
    fetchReadyMock.mockResolvedValue({ status: "ok", database: "ok" });
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(screen.getByText("API: ok")).toBeInTheDocument());
    expect(fetchHealthMock).toHaveBeenCalledTimes(2);
  });
});
