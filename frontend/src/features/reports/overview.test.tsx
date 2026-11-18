import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listOkrDepartments } from "@/features/okr/api";

import { listReportTables } from "./api";
import { getDashboard, isDashboard, type Dashboard } from "./dashboard";
import { OverviewScreen } from "./OverviewScreen";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children: React.ReactNode } & React.ComponentProps<"a">) => (
    <a href={href} aria-label={rest["aria-label"]}>
      {children}
    </a>
  ),
}));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  listReportTables: vi.fn(),
}));
vi.mock("@/features/okr/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/okr/api")>()),
  listOkrDepartments: vi.fn(),
}));
vi.mock("./dashboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./dashboard")>()),
  getDashboard: vi.fn(),
}));

const data: Dashboard = {
  day: "2026-11-18",
  period_from: "2026-09-24",
  period_to: "2026-12-02",
  cards: {
    total: 12,
    completed: 5,
    in_progress: 4,
    overdue: 2,
    at_risk: 3,
    blocked: 1,
    on_time_rate: 0.8,
    quality_score: null,
  },
  trend: [
    { week: "2026-11-02", created: 4, completed: 2 },
    { week: "2026-11-09", created: 3, completed: 5 },
  ],
  projects: [
    { table_id: "t-1", name: "Tasks", workspace_name: "Operations", total: 12, completed: 5, overdue: 2, blocked: 1 },
  ],
  people: [
    { user_id: "u-1", full_name: "Nguyen Van An", employee_code: "NV001", open: 4, overdue: 2, blocked: 1, done: 5 },
  ],
  okr: {
    cycle_id: "c-1",
    cycle_name: "Q4 2026",
    objectives: 3,
    key_results: 7,
    progress: 0.42,
    at_risk: 1,
    off_track: 1,
  },
  table_ids: ["t-1"],
  truncated: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listReportTables).mockResolvedValue([
    { id: "t-1", name: "Tasks", workspace_name: "Operations" },
  ]);
  vi.mocked(listOkrDepartments).mockResolvedValue([{ id: "d-1", name: "Sales", can_create: false }]);
  vi.mocked(getDashboard).mockResolvedValue(data);
});

describe("OverviewScreen", () => {
  it("shows the ten numbers, the trend and the work per project and per employee", async () => {
    render(<OverviewScreen />);
    const cards = within(await screen.findByRole("list", { name: "Key numbers" }));
    expect(cards.getAllByRole("listitem")).toHaveLength(10);
    expect(cards.getByText("Objectives · Q4 2026")).toBeInTheDocument();
    expect(cards.getByText("42%")).toBeInTheDocument();
    expect(cards.getByText("80%")).toBeInTheDocument();
    // The quality score is not measured yet: a dash, not a zero.
    const quality = cards.getByText("Quality score").closest("li");
    expect(quality).toHaveTextContent("—");

    expect(screen.getByRole("img", { name: /Nov 9 3 created, 5 completed/ })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Work per project" })).getByRole("link", { name: "Tasks" })).toHaveAttribute("href", "/tables/t-1");
    expect(
      within(screen.getByRole("region", { name: "Work per employee" })).getByText("NV001"),
    ).toBeInTheDocument();
  });

  it("leads each card to the tasks it counted when one table is in scope", async () => {
    render(<OverviewScreen />);
    const cards = within(await screen.findByRole("list", { name: "Key numbers" }));
    expect(cards.getByRole("link", { name: /Overdue tasks: 2/ })).toHaveAttribute(
      "href",
      "/tables/t-1?show=overdue",
    );
    expect(cards.getByRole("link", { name: /Blocked tasks: 1/ })).toHaveAttribute(
      "href",
      "/tables/t-1?show=blocked",
    );
  });

  it("has no card links when several tables are counted", async () => {
    vi.mocked(getDashboard).mockResolvedValue({ ...data, table_ids: ["t-1", "t-2"] });
    render(<OverviewScreen />);
    const cards = within(await screen.findByRole("list", { name: "Key numbers" }));
    expect(cards.queryByRole("link")).not.toBeInTheDocument();
  });

  it("asks again with the filters that were chosen, and can clear them", async () => {
    const user = userEvent.setup();
    render(<OverviewScreen />);
    await screen.findByRole("list", { name: "Key numbers" });
    await user.selectOptions(screen.getByLabelText("Status"), "blocked");
    await user.selectOptions(screen.getByLabelText("Department"), "d-1");
    await waitFor(() =>
      expect(getDashboard).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "blocked", departmentId: "d-1" }),
        expect.anything(),
      ),
    );
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() =>
      expect(getDashboard).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "", departmentId: "" }),
        expect.anything(),
      ),
    );
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("shows a number hidden from the reader as a dash", async () => {
    vi.mocked(getDashboard).mockResolvedValue({
      ...data,
      cards: { ...data.cards, overdue: null, at_risk: null },
    });
    render(<OverviewScreen />);
    const cards = within(await screen.findByRole("list", { name: "Key numbers" }));
    expect(cards.getByText("Overdue tasks").closest("li")).toHaveTextContent("—");
    expect(cards.queryByRole("link", { name: /Overdue tasks/ })).not.toBeInTheDocument();
  });

  it("switches the trend to a table", async () => {
    const user = userEvent.setup();
    render(<OverviewScreen />);
    await user.click(await screen.findByRole("button", { name: "Show as table" }));
    const trend = within(screen.getByRole("region", { name: "Trend" }));
    expect(trend.getByText("2026-11-09")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show chart" })).toBeInTheDocument();
  });

  it("says so when there is nothing to report", async () => {
    vi.mocked(getDashboard).mockResolvedValue({ ...data, table_ids: [], okr: null, projects: [], people: [] });
    render(<OverviewScreen />);
    expect(await screen.findByText("Nothing to report on yet.")).toBeInTheDocument();
  });

  it("tells the reader when the tasks were too many to count", async () => {
    vi.mocked(getDashboard).mockResolvedValue({ ...data, truncated: true });
    render(<OverviewScreen />);
    expect(await screen.findByText(/first 50,000/)).toBeInTheDocument();
  });
});

describe("isDashboard", () => {
  it("accepts what the server sends and refuses the rest", () => {
    expect(isDashboard(data)).toBe(true);
    expect(isDashboard({ ...data, okr: null })).toBe(true);
    expect(isDashboard({ ...data, cards: { ...data.cards, total: "5" } })).toBe(false);
    expect(isDashboard({ ...data, trend: [{ week: "x" }] })).toBe(false);
    expect(isDashboard(null)).toBe(false);
  });
});
