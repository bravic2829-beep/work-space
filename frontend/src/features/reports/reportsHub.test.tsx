import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ReportsHub } from "./ReportsHub";

// The two screens are tested on their own; here they only say which one is showing.
vi.mock("@/features/okr/OkrScreen", () => ({ OkrScreen: () => <p>OKR screen</p> }));
vi.mock("./ReportsScreen", () => ({ ReportsScreen: () => <p>Task overview screen</p> }));

describe("ReportsHub", () => {
  it("starts on the OKR and switches to the overview of the tasks", async () => {
    const user = userEvent.setup();
    render(<ReportsHub />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["OKR", "Task overview"]);
    expect(screen.getByRole("tab", { name: "OKR" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("OKR screen")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Task overview" }));
    expect(screen.getByText("Task overview screen")).toBeInTheDocument();
    expect(screen.queryByText("OKR screen")).not.toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveAttribute("id", "reports-panel-tasks");

    await user.click(screen.getByRole("tab", { name: "OKR" }));
    expect(screen.getByText("OKR screen")).toBeInTheDocument();
  });
});
