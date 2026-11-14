import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getUnreadCount } from "./api";
import { NotificationBell } from "./NotificationBell";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("./api", () => ({
  getUnreadCount: vi.fn(),
  listNotifications: vi.fn(),
  setNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));

const countMock = vi.mocked(getUnreadCount);

/** A WebSocket the test controls: nothing happens until the test says so. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  open() {
    act(() => this.onopen?.());
  }

  say(data: unknown) {
    act(() => this.onmessage?.({ data: typeof data === "string" ? data : JSON.stringify(data) }));
  }

  drop(code = 1006) {
    act(() => this.onclose?.({ code }));
  }
}

const last = () => FakeSocket.instances[FakeSocket.instances.length - 1];
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.resetAllMocks();
  vi.useRealTimers();
  FakeSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeSocket);
});

describe("NotificationBell live updates", () => {
  it("opens one socket on the same origin and closes it with the bell", async () => {
    countMock.mockResolvedValue(0);
    const { unmount } = render(<NotificationBell />);
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    expect(last().url).toBe(`ws://${window.location.host}/api/v1/ws`);
    unmount();
    expect(last().closed).toBe(true);
  });

  it("refreshes the number each time the socket (re)connects, to fetch what was missed", async () => {
    countMock.mockResolvedValueOnce(0).mockResolvedValue(2);
    render(<NotificationBell />);
    await screen.findByRole("button", { name: "Notifications, 0 unread" });

    last().open();

    expect(
      await screen.findByRole("button", { name: "Notifications, 2 unread" }),
    ).toBeInTheDocument();
    // Catching up is not news: no toast for what piled up while the page was closed.
    expect(screen.queryByText("You have a new notification.")).not.toBeInTheDocument();
  });

  it("updates the number and shows a toast when the server signals a change", async () => {
    countMock.mockResolvedValueOnce(0).mockResolvedValueOnce(0).mockResolvedValue(1);
    render(<NotificationBell />);
    await screen.findByRole("button", { name: "Notifications, 0 unread" });
    last().open();
    await waitFor(() => expect(countMock).toHaveBeenCalledTimes(2));

    last().say({ type: "notifications.changed" });

    expect(await screen.findByText("You have a new notification.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Notifications, 1 unread" })).toBeInTheDocument();
  });

  it("shows no toast when the signal does not raise the number", async () => {
    countMock.mockResolvedValue(3);
    render(<NotificationBell />);
    await screen.findByRole("button", { name: "Notifications, 3 unread" });
    last().open();
    await waitFor(() => expect(countMock).toHaveBeenCalledTimes(2));

    last().say({ type: "notifications.changed" });
    await waitFor(() => expect(countMock).toHaveBeenCalledTimes(3));

    expect(screen.queryByText("You have a new notification.")).not.toBeInTheDocument();
  });

  it("ignores messages it does not know", async () => {
    countMock.mockResolvedValue(0);
    render(<NotificationBell />);
    await screen.findByRole("button", { name: "Notifications, 0 unread" });
    last().open();
    await waitFor(() => expect(countMock).toHaveBeenCalledTimes(2));

    for (const junk of ["not json", "{}", '{"type":"other"}', "null", '"text"', "[1]"]) {
      last().say(junk);
    }
    last().say({ type: "ready" });
    last().say({ type: "pong" });

    expect(countMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says live updates are paused after a drop, then reconnects with a growing delay", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    countMock.mockResolvedValue(0);
    render(<NotificationBell />);
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    last().open();
    expect(screen.queryByText(/Live updates paused/)).not.toBeInTheDocument();

    last().drop();
    expect(screen.getByText(/Live updates paused/)).toBeInTheDocument();
    advance(999);
    expect(FakeSocket.instances).toHaveLength(1);
    advance(1);
    expect(FakeSocket.instances).toHaveLength(2); // after 1 s

    last().drop(); // still down: the next try waits 2 s
    advance(1999);
    expect(FakeSocket.instances).toHaveLength(2);
    advance(1);
    expect(FakeSocket.instances).toHaveLength(3);

    last().open(); // back online: the notice goes away and the delay starts again
    expect(screen.queryByText(/Live updates paused/)).not.toBeInTheDocument();
    last().drop();
    advance(1000);
    expect(FakeSocket.instances).toHaveLength(4);
  });

  it("does not reconnect after the server ended the session", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    countMock.mockResolvedValue(0);
    render(<NotificationBell />);
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));

    last().drop(4401);
    advance(120_000);

    expect(FakeSocket.instances).toHaveLength(1);
    expect(screen.getByText(/Live updates paused/)).toBeInTheDocument();
  });

  it("stops reconnecting once the bell is gone", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    countMock.mockResolvedValue(0);
    const { unmount } = render(<NotificationBell />);
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    last().drop();
    unmount();
    advance(120_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("still polls slowly as a safety net while the socket is down", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    countMock.mockResolvedValue(0);
    render(<NotificationBell />);
    await vi.waitFor(() => expect(countMock).toHaveBeenCalledTimes(1));
    advance(60_000);
    await vi.waitFor(() => expect(countMock.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});
