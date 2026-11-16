import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import { ASSIGNEE, NAME, makeField, makeRecord } from "./fixtures";
import { RecordGrid } from "./RecordGrid";
import { elapsedMs, formatDuration, timerFields, timerRights, timerState } from "./timer";
import { TimerCell } from "./TimerCell";

const timerMock = vi.fn();
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  timerRecord: (...args: unknown[]) => timerMock(...args),
}));

const START = makeField("f-start", "Started at", "date", {
  semantic: "timer_start",
  config: { include_time: true },
});
const STOP = makeField("f-stop", "Finished at", "date", {
  semantic: "timer_stop",
  config: { include_time: true },
});
const FIELDS = [NAME, ASSIGNEE, START, STOP].map((f, position) => ({ ...f, position }));

// The task was created by "u-me" (who gave it) and is assigned to "u-ann".
function task(data: Record<string, unknown> = {}) {
  return makeRecord("r-1", { "f-name": "Count", "f-assignee": ["u-ann"], ...data });
}

beforeEach(() => {
  timerMock.mockReset();
});

describe("the timer helpers", () => {
  it("finds both columns, or none", () => {
    expect(timerFields(FIELDS)?.start.id).toBe("f-start");
    expect(timerFields([NAME, ASSIGNEE, START])).toBeNull();
  });

  it("is idle, running or stopped by which moments are set", () => {
    expect(timerState(FIELDS, task()).phase).toBe("idle");
    expect(timerState(FIELDS, task({ "f-start": "2026-11-14T08:00:00Z" })).phase).toBe("running");
    expect(
      timerState(
        FIELDS,
        task({ "f-start": "2026-11-14T08:00:00Z", "f-stop": "2026-11-14T09:30:05Z" }),
      ).phase,
    ).toBe("stopped");
  });

  it("measures the time to now while running and to the stop when stopped", () => {
    const start = Date.parse("2026-11-14T08:00:00Z");
    const running = timerState(FIELDS, task({ "f-start": "2026-11-14T08:00:00Z" }));
    expect(elapsedMs(running, start + 65_000)).toBe(65_000);
    const done = timerState(
      FIELDS,
      task({ "f-start": "2026-11-14T08:00:00Z", "f-stop": "2026-11-14T09:30:05Z" }),
    );
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
    const running = task({ "f-start": "2026-11-14T08:00:00Z" });
    expect(timerRights(FIELDS, idle, "u-me", false)).toEqual({ start: true, stop: false });
    expect(timerRights(FIELDS, idle, "u-ann", false)).toEqual({ start: false, stop: false });
    expect(timerRights(FIELDS, running, "u-ann", false)).toEqual({ start: false, stop: true });
    expect(timerRights(FIELDS, running, "u-other", false)).toEqual({ start: false, stop: false });
    expect(timerRights(FIELDS, idle, "u-other", true).start).toBe(true);
  });
});

describe("TimerCell", () => {
  function setup(record = task(), who = "u-me") {
    const onChanged = vi.fn();
    render(
      <TimerCell
        fields={FIELDS}
        record={record}
        currentUserId={who}
        isAdmin={false}
        onChanged={onChanged}
      />,
    );
    return { onChanged, user: userEvent.setup() };
  }

  it("starts the timer for the person who gave the task", async () => {
    const started = task({ "f-start": "2026-11-14T08:00:00Z" });
    timerMock.mockResolvedValue(started);
    const { user, onChanged } = setup();

    await user.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(started));
    expect(timerMock).toHaveBeenCalledWith("r-1", 1, "start");
  });

  it("lets the assignee stop a running timer, and shows the clock", async () => {
    const running = task({ "f-start": new Date(Date.now() - 125_000).toISOString() });
    const stopped = task({ "f-start": "2026-11-14T08:00:00Z", "f-stop": "2026-11-14T08:05:00Z" });
    timerMock.mockResolvedValue(stopped);
    const { user, onChanged } = setup(running, "u-ann");

    expect(screen.getByRole("timer")).toHaveTextContent(/^0:02:0\d$/);
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(stopped));
    expect(timerMock).toHaveBeenCalledWith("r-1", 1, "stop");
  });

  it("shows the time spent, with no buttons, once stopped", () => {
    setup(
      task({ "f-start": "2026-11-14T08:00:00Z", "f-stop": "2026-11-14T09:30:05Z" }),
      "u-ann",
    );
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

describe("the Time column of the table", () => {
  it("appears after the timer columns, with the buttons of each row", () => {
    render(
      <RecordGrid
        fields={FIELDS}
        records={[task()]}
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
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers.slice(-2)).toEqual(["Finished at", "Time"]);
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
  });

  it("is absent from a table without a timer", () => {
    render(
      <RecordGrid
        fields={[NAME]}
        records={[task()]}
        names={new Map()}
        sort={[]}
        selectedId={null}
        hasMore={false}
        loadingMore={false}
        onSort={vi.fn()}
        onSelect={vi.fn()}
        onLoadMore={vi.fn()}
      />,
    );
    expect(screen.queryByRole("columnheader", { name: "Time" })).not.toBeInTheDocument();
  });
});
