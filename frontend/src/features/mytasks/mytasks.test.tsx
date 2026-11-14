import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import { listMyTasks } from "./api";
import { MyTasksScreen } from "./MyTasksScreen";
import { isMyTask, isMyTaskPage, localToday } from "./schema";
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
});

describe("MyTasksScreen", () => {
  it("lists tasks assigned to me from several tables", async () => {
    listMock.mockResolvedValue({
      items: [
        task("a", "Call client", {
          status: { name: "In progress", kind: "in_progress" },
          due_date: "2026-11-13",
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
    expect(screen.getByText("2026-11-13")).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "Assigned to me" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Today's tasks" }));

    expect(await screen.findByText("Due today")).toBeInTheDocument();
    expect(screen.queryByText("Call client")).not.toBeInTheDocument();
    expect(listMock).toHaveBeenLastCalledWith("today", null, expect.any(AbortSignal));
    expect(screen.getByRole("button", { name: "Today's tasks" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("has a message for each empty list", async () => {
    listMock.mockResolvedValue({ items: [], next_cursor: null });
    render(<MyTasksScreen />);
    const user = userEvent.setup();
    expect(await screen.findByText("No tasks are assigned to you.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Today's tasks" }));
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
