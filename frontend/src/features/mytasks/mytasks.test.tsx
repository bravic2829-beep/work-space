import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import { listMyTasks } from "./api";
import { MyTasksScreen } from "./MyTasksScreen";
import { dueInfo, isMyTask, isMyTaskPage, localToday } from "./schema";
import type { MyTask } from "./schema";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("./api", () => ({ listMyTasks: vi.fn() }));

const listMock = vi.mocked(listMyTasks);

function task(id: string, name: string | null, overrides: Partial<MyTask> = {}): MyTask {
  return {
    id,
    table_id: "t-1",
    table_name: "Sales",
    name,
    due_date: null,
    status: null,
    created_at: "2026-11-13T01:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("my task shapes", () => {
  it("accepts valid tasks and rejects wrong shapes", () => {
    expect(isMyTask(task("a", "x"))).toBe(true);
    expect(isMyTask(task("a", null, { status: { name: "Done", kind: "done" } }))).toBe(true);
    expect(isMyTaskPage({ items: [task("a", "x")], next_cursor: null })).toBe(true);
    expect(isMyTask({ ...task("a", "x"), status: { name: "Done" } })).toBe(false);
    expect(isMyTask({ ...task("a", "x"), due_date: 5 })).toBe(false);
    expect(isMyTask(null)).toBe(false);
    expect(isMyTaskPage({ items: [{}], next_cursor: null })).toBe(false);
  });

  it("writes the day of the browser as YYYY-MM-DD", () => {
    expect(localToday(new Date(2026, 10, 3))).toBe("2026-11-03");
    expect(localToday(new Date(2026, 0, 31))).toBe("2026-01-31");
  });

  it("words a due date relative to today", () => {
    const today = "2026-11-14";
    expect(dueInfo(null, today)).toBeNull();
    expect(dueInfo("2026-11-14", today)).toEqual({ label: "Today", tone: "today" });
    expect(dueInfo("2026-11-15", today)).toEqual({ label: "Tomorrow", tone: "normal" });
    expect(dueInfo("2026-11-21", today)).toEqual({ label: "2026-11-21", tone: "normal" });
    expect(dueInfo("2026-11-13", today)).toEqual({ label: "Overdue 1 day", tone: "overdue" });
    expect(dueInfo("2026-11-11", today)).toEqual({ label: "Overdue 3 days", tone: "overdue" });
    // Across a month and a year boundary.
    expect(dueInfo("2026-12-31", "2027-01-02")).toEqual({ label: "Overdue 2 days", tone: "overdue" });
    expect(dueInfo("not a date", today)).toEqual({ label: "not a date", tone: "normal" });
  });
});

describe("MyTasksScreen", () => {
  it("lists tasks assigned to me from several tables", async () => {
    listMock.mockResolvedValue({
      items: [
        task("a", "Call client", {
          status: { name: "In progress", kind: "in_progress" },
          due_date: "2099-01-05",
        }),
        task("b", "Fix router", { table_id: "t-2", table_name: "Ops" }),
      ],
      next_cursor: null,
    });
    render(<MyTasksScreen />);

    expect(await screen.findByRole("link", { name: "Call client" })).toHaveAttribute(
      "href",
      "/tables/t-1",
    );
    expect(screen.getByRole("link", { name: "Fix router" })).toHaveAttribute("href", "/tables/t-2");
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("2099-01-05")).toBeInTheDocument();
    expect(listMock).toHaveBeenCalledWith("assigned", null, expect.any(AbortSignal));
  });

  it("switches to today's tasks", async () => {
    listMock
      .mockResolvedValueOnce({
        items: [task("a", "Call client")],
        next_cursor: null,
      })
      .mockResolvedValueOnce({
        items: [task("b", "Due today")],
        next_cursor: null,
      });
    render(<MyTasksScreen />);
    const user = userEvent.setup();

    await screen.findByText("Call client");
    expect(screen.getByRole("tab", { name: "Assigned to me" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.click(screen.getByRole("tab", { name: "Due today" }));

    expect(await screen.findByText("Due today", { selector: "a" })).toBeInTheDocument();
    expect(screen.queryByText("Call client")).not.toBeInTheDocument();
    expect(listMock).toHaveBeenLastCalledWith("today", null, expect.any(AbortSignal));
    expect(screen.getByRole("tab", { name: "Due today" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("groups the assigned tasks by urgency, late ones first", async () => {
    listMock.mockResolvedValue({
      items: [
        task("c", "Not late", { due_date: "2099-01-01" }),
        task("a", "Late one", { due_date: "2000-01-01" }),
        task("b", "Late but finished", {
          due_date: "2000-01-01",
          status: { name: "Done", kind: "done" },
        }),
      ],
      next_cursor: null,
    });
    render(<MyTasksScreen />);
    const user = userEvent.setup();

    expect(await screen.findByText("Late one")).toBeInTheDocument();
    const overdue = screen.getByRole("region", { name: "Overdue" });
    expect(within(overdue).getByText("Late one")).toBeInTheDocument();
    expect(within(overdue).getByText(/^\d+ days$/)).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Later" })).getByText("Not late")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Done" })).getByText("Late but finished")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Today" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Overdue" }));

    expect(screen.getByRole("tab", { name: "Overdue" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Late one")).toBeInTheDocument();
    expect(screen.queryByText("Not late")).not.toBeInTheDocument();
    expect(screen.queryByText("Late but finished")).not.toBeInTheDocument();
    // The same list was reused: no second request for the overdue tab.
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it("has a message for each empty list", async () => {
    listMock.mockResolvedValue({ items: [], next_cursor: null });
    render(<MyTasksScreen />);
    const user = userEvent.setup();
    expect(await screen.findByText("No tasks are assigned to you.")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Due today" }));
    expect(await screen.findByText("Nothing is due today.")).toBeInTheDocument();
  });

  it("shows a task whose name is hidden without leaking it", async () => {
    listMock.mockResolvedValue({ items: [task("a", null)], next_cursor: null });
    render(<MyTasksScreen />);
    expect(await screen.findByRole("link", { name: "(name hidden)" })).toBeInTheDocument();
  });

  it("loads the next page", async () => {
    listMock
      .mockResolvedValueOnce({
        items: [task("a", "First")],
        next_cursor: "next",
      })
      .mockResolvedValueOnce({
        items: [task("b", "Second")],
        next_cursor: null,
      });
    render(<MyTasksScreen />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Load more" }));
    expect(listMock).toHaveBeenLastCalledWith("assigned", "next");
    expect(await screen.findByText("Second")).toBeInTheDocument();
    expect(screen.getByText("First")).toBeInTheDocument();
  });

  it("shows an error when the tasks cannot be loaded", async () => {
    listMock.mockRejectedValue(new ApiError("Authentication is required.", 401));
    render(<MyTasksScreen />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Authentication is required.");
  });
});
