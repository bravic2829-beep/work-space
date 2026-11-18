import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ReportsHub } from "./ReportsHub";

// The screens are tested on their own; here they only say which one is showing.
vi.mock("@/features/okr/OkrScreen", () => ({ OkrScreen: () => <p>OKR screen</p> }));
vi.mock("@/features/performance/PerformanceScreen", () => ({
  PerformanceScreen: () => <p>Performance screen</p>,
}));
vi.mock("./OverviewScreen", () => ({ OverviewScreen: () => <p>Overview screen</p> }));
vi.mock("./ReportsScreen", () => ({ ReportsScreen: () => <p>Task overview screen</p> }));

describe("ReportsHub", () => {
  it("starts on the overview and switches between the screens", async () => {
    const user = userEvent.setup();
    render(<ReportsHub />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Overview",
      "OKR",
      "Performance",
      "Task overview",
    ]);
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Overview screen")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "OKR" }));
    expect(screen.getByText("OKR screen")).toBeInTheDocument();
    expect(screen.queryByText("Overview screen")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Performance" }));
    expect(screen.getByText("Performance screen")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Task overview" }));
    expect(screen.getByText("Task overview screen")).toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveAttribute("id", "reports-panel-tasks");

    await user.click(screen.getByRole("tab", { name: "Overview" }));
    expect(screen.getByText("Overview screen")).toBeInTheDocument();
  });
});
