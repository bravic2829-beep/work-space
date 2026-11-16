import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import { getOverview, isOverview, listReportTables, type Overview } from "./api";
import { ReportsScreen } from "./ReportsScreen";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  listReportTables: vi.fn(),
  getOverview: vi.fn(),
}));

const report: Overview = {
  table_id: "t-1",
  table_name: "Tasks",
  day: "2026-11-14",
  total: 5,
  open: 4,
  in_review: 1,
  done: 1,
  overdue: 2,
  due_today: 1,
  unassigned: 1,
  by_status: [
    { kind: "todo", name: "To do", count: 2 },
    { kind: "review", name: "Pending review", count: 1 },
    { kind: "done", name: "Done", count: 1 },
  ],
  people: [
    { user_id: "u-1", full_name: "Nguyen Van An", employee_code: "NV001", open: 3, overdue: 2, in_review: 0, done: 1 },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listReportTables).mockResolvedValue([
    { id: "t-1", name: "Tasks", workspace_name: "Operations" },
    { id: "t-2", name: "Projects", workspace_name: "Marketing" },
  ]);
  vi.mocked(getOverview).mockResolvedValue(report);
});

describe("ReportsScreen", () => {
  it("shows the totals, the statuses and the work per person of the first table", async () => {
    render(<ReportsScreen />);
    const totals = await screen.findByRole("list", { name: "Totals" });
    expect(within(totals).getByText("Overdue").previousSibling).toHaveTextContent("2");
    expect(within(totals).getByText("Waiting for review").previousSibling).toHaveTextContent("1");
    expect(screen.getByText(/Pending review:/)).toBeInTheDocument();
    const people = screen.getByRole("region", { name: "Work per person" });
    expect(within(people).getByText("Nguyen Van An")).toBeInTheDocument();
    expect(getOverview).toHaveBeenCalledWith("t-1", expect.anything());
  });

  it("switches to another table", async () => {
    render(<ReportsScreen />);
    await screen.findByRole("list", { name: "Totals" });
    await userEvent.setup().selectOptions(screen.getByRole("combobox", { name: "Table" }), "t-2");
    expect(getOverview).toHaveBeenLastCalledWith("t-2", expect.anything());
  });

  it("shows a dash for a number whose column is hidden", async () => {
    vi.mocked(getOverview).mockResolvedValue({ ...report, overdue: null, due_today: null });
    render(<ReportsScreen />);
    const totals = await screen.findByRole("list", { name: "Totals" });
    expect(within(totals).getByText("Overdue").previousSibling).toHaveTextContent("—");
  });

  it("explains an empty list and an error", async () => {
    vi.mocked(listReportTables).mockResolvedValueOnce([]);
    const { unmount } = render(<ReportsScreen />);
    expect(await screen.findByText("No task table to report on.")).toBeInTheDocument();
    unmount();
    vi.mocked(getOverview).mockRejectedValueOnce(new ApiError("You do not have access.", 403));
    render(<ReportsScreen />);
    expect(await screen.findByRole("alert")).toHaveTextContent("You do not have access.");
  });

  it("checks the shape of what the server sends", () => {
    expect(isOverview(report)).toBe(true);
    expect(isOverview({ ...report, people: [{ user_id: "x" }] })).toBe(false);
    expect(isOverview({ ...report, overdue: "2" })).toBe(false);
  });
});
