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
  blocked: 1,
  paused: 0,
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
    {
      user_id: "u-1",
      full_name: "Nguyen Van An",
      employee_code: "NV001",
      open: 3,
      overdue: 2,
      in_review: 0,
      blocked: 1,
      done: 1,
    },
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

  it("shows the blocked and paused tasks", async () => {
    vi.mocked(getOverview).mockResolvedValue({ ...report, blocked: 3, paused: 2 });
    render(<ReportsScreen />);
    const totals = await screen.findByRole("list", { name: "Totals" });
    expect(within(totals).getByText("Blocked").previousSibling).toHaveTextContent("3");
    expect(within(totals).getByText("Paused").previousSibling).toHaveTextContent("2");
  });

  it("opens the counted tasks when a number is clicked", async () => {
    render(<ReportsScreen />);
    const totals = await screen.findByRole("list", { name: "Totals" });
    const link = (label: string) => within(totals).getByText(label).closest("a");
    expect(link("Overdue")).toHaveAttribute("href", "/tables/t-1?show=overdue");
    expect(link("Open")).toHaveAttribute("href", "/tables/t-1?show=open");
    expect(link("Due today")).toHaveAttribute("href", "/tables/t-1?show=due_today");
    expect(link("Waiting for review")).toHaveAttribute("href", "/tables/t-1?show=review");
    expect(link("Blocked")).toHaveAttribute("href", "/tables/t-1?show=blocked");
    expect(link("Paused")).toHaveAttribute("href", "/tables/t-1?show=paused");
    expect(link("Done")).toHaveAttribute("href", "/tables/t-1?show=done");
    expect(link("Unassigned")).toHaveAttribute("href", "/tables/t-1?show=unassigned");
  });

  it("opens one person's tasks from the work per person table", async () => {
    render(<ReportsScreen />);
    const people = await screen.findByRole("region", { name: "Work per person" });
    const row = within(people).getByText("Nguyen Van An").closest("tr") as HTMLElement;
    const links = within(row).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/tables/t-1?show=open&person=u-1",
      "/tables/t-1?show=overdue&person=u-1",
      "/tables/t-1?show=blocked&person=u-1",
      "/tables/t-1?show=done&person=u-1",
    ]);
    // "Waiting for review" is 0 for this person, so there is nothing to open.
    expect(within(row).getByText("0")).toBeInTheDocument();
  });

  it("does not link a number whose column is hidden", async () => {
    vi.mocked(getOverview).mockResolvedValue({ ...report, overdue: null });
    render(<ReportsScreen />);
    const totals = await screen.findByRole("list", { name: "Totals" });
    expect(within(totals).getByText("Overdue").closest("a")).toBeNull();
  });

  it("offers the Excel file of the chosen table", async () => {
    render(<ReportsScreen />);
    const link = await screen.findByRole("link", { name: /Export to Excel/ });
    const href = link.getAttribute("href") ?? "";
    expect(href).toMatch(/^\/api\/v1\/reports\/export\?table_id=t-1&date=\d{4}-\d{2}-\d{2}$/);
    expect(link).toHaveAttribute("download");
    await userEvent.setup().selectOptions(screen.getByRole("combobox", { name: "Table" }), "t-2");
    expect(screen.getByRole("link", { name: /Export to Excel/ }).getAttribute("href")).toContain(
      "table_id=t-2",
    );
  });

  it("checks the shape of what the server sends", () => {
    expect(isOverview(report)).toBe(true);
    expect(isOverview({ ...report, people: [{ user_id: "x" }] })).toBe(false);
    expect(isOverview({ ...report, overdue: "2" })).toBe(false);
  });
});
