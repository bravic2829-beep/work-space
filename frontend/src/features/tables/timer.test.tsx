import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import { ASSIGNEE, NAME, makeField, makeRecord } from "./fixtures";
import { RecordGrid } from "./RecordGrid";
import {
  describeTimer,
  elapsedMs,
  formatDuration,
  timerColumns,
  timerHeadings,
  timerRights,
  timerState,
} from "./timer";
import { TimerCell } from "./TimerCell";
import { displayValue } from "./values";

const timerMock = vi.fn();
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  timerRecord: (...args: unknown[]) => timerMock(...args),
}));

const TIMER = makeField("f-timer", "Timer", "timer");
const FIELDS = [NAME, ASSIGNEE, TIMER].map((f, position) => ({ ...f, position }));

const BEGAN = "2026-11-14T08:00:00Z";
const ENDED = "2026-11-14T09:30:05Z";

// The task was created by "u-me" (who gave it) and is assigned to "u-ann".
function task(timer?: Record<string, string>) {
  return makeRecord("r-1", {
    "f-name": "Count",
    "f-assignee": ["u-ann"],
    ...(timer ? { "f-timer": timer } : {}),
  });
}

beforeEach(() => {
  timerMock.mockReset();
});

describe("the timer helpers", () => {
  it("finds every timer column, or none", () => {
    expect(timerColumns(FIELDS).map((f) => f.id)).toEqual(["f-timer"]);
    expect(timerColumns([NAME, ASSIGNEE])).toEqual([]);
    const second = makeField("f-second", "Review time", "timer");
    expect(timerColumns([...FIELDS, second]).map((f) => f.id)).toEqual(["f-timer", "f-second"]);
  });

  it("is idle, running or stopped by which moments the cell holds", () => {
    expect(timerState(TIMER, task()).phase).toBe("idle");
    expect(timerState(TIMER, task({ started_at: BEGAN })).phase).toBe("running");
    expect(timerState(TIMER, task({ started_at: BEGAN, finished_at: ENDED })).phase).toBe(
      "stopped",
    );
  });

  it("treats a cell that is not an object as not started", () => {
    const odd = makeRecord("r-2", { "f-timer": "yesterday" });
    expect(timerState(TIMER, odd).phase).toBe("idle");
  });

  it("measures the time to now while running and to the stop when stopped", () => {
    const start = Date.parse(BEGAN);
    const running = timerState(TIMER, task({ started_at: BEGAN }));
    expect(elapsedMs(running, start + 65_000)).toBe(65_000);
    const done = timerState(TIMER, task({ started_at: BEGAN, finished_at: ENDED }));
    expect(elapsedMs(done, start + 999_999_999)).toBe(5405_000);
    expect(elapsedMs({ phase: "idle", startedAt: null, stoppedAt: null }, start)).toBe(0);
  });

  it("writes a duration as hours:minutes:seconds", () => {
    expect(formatDuration(0)).toBe("0:00:00");
    expect(formatDuration(65_000)).toBe("0:01:05");
    expect(formatDuration(5405_000)).toBe("1:30:05");
    expect(formatDuration(100 * 3600_000)).toBe("100:00:00");
  });

  it("offers Start to who gave the task and Stop to the assignee", () => {
    const idle = task();
    const running = task({ started_at: BEGAN });
    expect(timerRights(FIELDS, TIMER, idle, "u-me", false)).toEqual({ start: true, stop: false });
    expect(timerRights(FIELDS, TIMER, idle, "u-ann", false)).toEqual({
      start: false,
      stop: false,
    });
    expect(timerRights(FIELDS, TIMER, running, "u-ann", false)).toEqual({
      start: false,
      stop: true,
    });
    expect(timerRights(FIELDS, TIMER, running, "u-other", false)).toEqual({
      start: false,
      stop: false,
    });
    expect(timerRights(FIELDS, TIMER, idle, "u-other", true).start).toBe(true);
  });

  it("names the three columns plainly for one timer, and by column for several", () => {
    expect(timerHeadings(TIMER, FIELDS)).toEqual({
      started: "Started at",
      finished: "Finished at",
      time: "Time",
    });
    const second = makeField("f-second", "Review time", "timer");
    expect(timerHeadings(second, [...FIELDS, second]).started).toBe("Review time · Started at");
  });

  it("describes a cell in words, for the history and the lists", () => {
    expect(describeTimer(undefined)).toBe("");
    expect(describeTimer({ started_at: BEGAN })).toMatch(/→ running$/);
    expect(describeTimer({ started_at: BEGAN, finished_at: ENDED })).toMatch(/\(1:30:05\)$/);
    expect(displayValue(TIMER, { started_at: BEGAN, finished_at: ENDED }, new Map())).toMatch(
      /\(1:30:05\)$/,
    );
  });
});

describe("TimerCell", () => {
  function setup(record = task(), who = "u-me") {
    const onChanged = vi.fn();
    render(
      <TimerCell
        fields={FIELDS}
        field={TIMER}
        record={record}
        currentUserId={who}
        isAdmin={false}
        onChanged={onChanged}
      />,
    );
    return { onChanged, user: userEvent.setup() };
  }

  it("starts the timer for the person who gave the task", async () => {
    const started = task({ started_at: BEGAN });
    timerMock.mockResolvedValue(started);
    const { user, onChanged } = setup();

    await user.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(started));
    expect(timerMock).toHaveBeenCalledWith("r-1", 1, "start", "f-timer");
  });

  it("lets the assignee stop a running timer, and shows the clock", async () => {
    const running = task({ started_at: new Date(Date.now() - 125_000).toISOString() });
    const stopped = task({ started_at: BEGAN, finished_at: "2026-11-14T08:05:00Z" });
    timerMock.mockResolvedValue(stopped);
    const { user, onChanged } = setup(running, "u-ann");

    expect(screen.getByRole("timer")).toHaveTextContent(/^0:02:0\d$/);
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(stopped));
    expect(timerMock).toHaveBeenCalledWith("r-1", 1, "stop", "f-timer");
  });

  it("shows the time spent, with no buttons, once stopped", () => {
    setup(task({ started_at: BEGAN, finished_at: ENDED }), "u-ann");
    expect(screen.getByRole("timer")).toHaveTextContent("1:30:05");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("says Not started to somebody who cannot start it", () => {
    setup(task(), "u-ann");
    expect(screen.getByText("Not started")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the reason when the server refuses", async () => {
    timerMock.mockRejectedValue(new ApiError("The timer was already started.", 409));
    const { user, onChanged } = setup();
    await user.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already started");
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe("the timer columns of the table", () => {
  function grid(fields = FIELDS, records = [task()]) {
    render(
      <RecordGrid
        fields={fields}
        records={records}
        names={new Map()}
        sort={[]}
        selectedId={null}
        hasMore={false}
        loadingMore={false}
        onSort={vi.fn()}
        onSelect={vi.fn()}
        onLoadMore={vi.fn()}
        currentUserId="u-me"
      />,
    );
  }

  it("draws one timer field as one Time column, with the buttons of each row", () => {
    grid();
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers.slice(-1)).toEqual(["Time"]);
    expect(headers).not.toContain("Started at");
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
  });

  it("shows the time spent, with when it started and finished in the tooltip", () => {
    grid(FIELDS, [task({ started_at: BEGAN, finished_at: ENDED })]);
    const cell = screen.getByText("1:30:05").closest("td");
    expect(cell).toHaveAttribute("title", expect.stringContaining("1:30:05"));
    expect(cell).toHaveAttribute("title", expect.stringContaining("→"));
  });

  it("shows a dash for a timer that has not started and cannot be started by the person", () => {
    grid(FIELDS, [{ ...task(), created_by: "u-other" }]);
    expect(screen.queryByText("Not started")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("keeps two timers apart by the name of their column", () => {
    const second = { ...makeField("f-second", "Review time", "timer"), position: 3 };
    grid([...FIELDS, second]);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toContain("Timer · Time");
    expect(headers).toContain("Review time · Time");
  });

  it("is absent from a table without a timer", () => {
    grid([NAME]);
    expect(screen.queryByRole("columnheader", { name: /time/i })).not.toBeInTheDocument();
  });
});
