import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listMyTasks } from "@/features/mytasks/api";
import { MyTasksScreen } from "@/features/mytasks/MyTasksScreen";
import type { MyTask } from "@/features/mytasks/schema";

import { emitLiveChange } from "./liveRefresh";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/features/mytasks/api", () => ({ listMyTasks: vi.fn() }));

const listMock = vi.mocked(listMyTasks);

function task(id: string, name: string): MyTask {
  return {
    id,
    table_id: "t-1",
    table_name: "Sales",
    name,
    due_date: null,
    status: null,
    created_at: "2026-11-13T01:00:00Z",
  };
}

beforeEach(() => vi.resetAllMocks());

describe("live refresh", () => {
  it("shows a task that was just given to me when the live signal arrives", async () => {
    listMock.mockResolvedValueOnce({ items: [task("a", "First task")], next_cursor: null });
    render(<MyTasksScreen />);
    expect(await screen.findByText("First task")).toBeInTheDocument();
    expect(screen.queryByText("Brand new task")).not.toBeInTheDocument();

    listMock.mockResolvedValueOnce({
      items: [task("b", "Brand new task"), task("a", "First task")],
      next_cursor: null,
    });
    act(() => emitLiveChange());

    await waitFor(() => expect(screen.getByText("Brand new task")).toBeInTheDocument());
    expect(listMock).toHaveBeenCalledTimes(2);
  });
});
