import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import {
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  setNotificationRead,
} from "./api";
import { NotificationBell } from "./NotificationBell";
import { describe as sentence, isNotification, isNotificationPage, isUnreadCount } from "./schema";
import type { Notification } from "./schema";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    onClick,
  }: {
    href: string;
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        onClick?.();
      }}
    >
      {children}
    </a>
  ),
}));
vi.mock("./api", () => ({
  getUnreadCount: vi.fn(),
  listNotifications: vi.fn(),
  setNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));

const countMock = vi.mocked(getUnreadCount);
const listMock = vi.mocked(listNotifications);
const readMock = vi.mocked(setNotificationRead);
const readAllMock = vi.mocked(markAllNotificationsRead);

function note(overrides: Partial<Notification> = {}): Notification {
  return {
    id: "n1",
    type: "task_assigned",
    record_id: "r1",
    table_id: "t1",
    record_name: "Launch",
    actor: { id: "u1", full_name: "Boss Person" },
    read_at: null,
    created_at: "2026-11-13T10:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  // The socket is tested in liveUpdates.test.tsx. Here nobody answers on the other end.
  vi.stubGlobal(
    "WebSocket",
    class {
      close() {}
    },
  );
});

describe("notification shapes", () => {
  it("accepts a valid notification and page", () => {
    expect(isNotification(note())).toBe(true);
    expect(isNotification(note({ record_name: null, read_at: "2026-11-13T11:00:00Z" }))).toBe(true);
    expect(isNotificationPage({ items: [note()], next_cursor: null })).toBe(true);
    expect(isUnreadCount({ unread: 0 })).toBe(true);
  });

  it("rejects wrong shapes from the network", () => {
    expect(isNotification({ ...note(), type: "something_else" })).toBe(false);
    expect(isNotification(note({ type: "review_requested" }))).toBe(true);
    expect(isNotification({ ...note(), actor: { id: "u1" } })).toBe(false);
    expect(isNotification({ ...note(), read_at: 5 })).toBe(false);
    expect(isNotification(null)).toBe(false);
    expect(isNotificationPage({ items: [{}], next_cursor: null })).toBe(false);
    expect(isNotificationPage({ items: [], next_cursor: 3 })).toBe(false);
    expect(isUnreadCount({ unread: -1 })).toBe(false);
    expect(isUnreadCount({ unread: 1.5 })).toBe(false);
    expect(isUnreadCount({ unread: "2" })).toBe(false);
  });

  it("words the message, hiding a task name that is not shown", () => {
    expect(sentence(note())).toBe('Boss Person assigned you "Launch"');
    expect(sentence(note({ record_name: null }))).toBe("Boss Person assigned you a task");
    expect(sentence(note({ type: "review_requested" }))).toBe(
      'Boss Person asks you to review "Launch"',
    );
  });
});

describe("NotificationBell", () => {
  it("shows how many are unread", async () => {
    countMock.mockResolvedValue(3);
    render(<NotificationBell />);
    expect(await screen.findByRole("button", { name: "Notifications, 3 unread" })).toBeVisible();
    expect(screen.getByText("3")).toBeInTheDocument(); // the badge on the bell
  });

  it("shows no number when everything is read", async () => {
    countMock.mockResolvedValue(0);
    render(<NotificationBell />);
    await waitFor(() => expect(countMock).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Notifications, 0 unread" })).toBeVisible();
    expect(screen.queryByText(/^\d+\+?$/)).not.toBeInTheDocument(); // no badge
  });

  it("still works when the count cannot be loaded", async () => {
    countMock.mockRejectedValue(new ApiError("Network error: the server could not be reached"));
    render(<NotificationBell />);
    await waitFor(() => expect(countMock).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Notifications, 0 unread" })).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("lists notifications when opened, with a link to the table", async () => {
    countMock.mockResolvedValue(1);
    listMock.mockResolvedValue({
      items: [note(), note({ id: "n2", record_name: null, read_at: "2026-11-13T11:00:00Z" })],
      next_cursor: null,
    });
    render(<NotificationBell />);
    await userEvent.click(await screen.findByRole("button", { name: /Notifications/ }));

    const panel = await screen.findByRole("region", { name: "Notifications" });
    expect(
      within(panel).getByText('Boss Person assigned you "Launch"').closest("a"),
    ).toHaveAttribute("href", "/tables/t1");
    expect(within(panel).getByText("Boss Person assigned you a task")).toBeInTheDocument();
  });

  it("says so when there is nothing", async () => {
    countMock.mockResolvedValue(0);
    listMock.mockResolvedValue({ items: [], next_cursor: null });
    render(<NotificationBell />);
    await userEvent.click(await screen.findByRole("button", { name: /Notifications/ }));
    expect(await screen.findByText("No notifications.")).toBeInTheDocument();
  });

  it("shows an error when the list cannot be loaded", async () => {
    countMock.mockResolvedValue(0);
    listMock.mockRejectedValue(new ApiError("Request failed (500)", 500));
    render(<NotificationBell />);
    await userEvent.click(await screen.findByRole("button", { name: /Notifications/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load notifications.");
  });

  it("marks a notification read when it is clicked, and updates the number", async () => {
    countMock.mockResolvedValueOnce(1).mockResolvedValue(1).mockResolvedValue(0);
    listMock.mockResolvedValue({ items: [note()], next_cursor: null });
    readMock.mockResolvedValue(note({ read_at: "2026-11-13T12:00:00Z" }));
    render(<NotificationBell />);
    await userEvent.click(await screen.findByRole("button", { name: /Notifications/ }));
    await userEvent.click(await screen.findByText('Boss Person assigned you "Launch"'));

    expect(readMock).toHaveBeenCalledWith("n1", true);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Notifications, 0 unread" })).toBeVisible(),
    );
  });

  it("does not call the server for a notification that is already read", async () => {
    countMock.mockResolvedValue(0);
    listMock.mockResolvedValue({
      items: [note({ read_at: "2026-11-13T11:00:00Z" })],
      next_cursor: null,
    });
    render(<NotificationBell />);
    await userEvent.click(await screen.findByRole("button", { name: /Notifications/ }));
    await userEvent.click(await screen.findByText('Boss Person assigned you "Launch"'));
    expect(readMock).not.toHaveBeenCalled();
  });

  it("shows an error when marking as read fails", async () => {
    countMock.mockResolvedValue(1);
    listMock.mockResolvedValue({ items: [note()], next_cursor: null });
    readMock.mockRejectedValue(new ApiError("Request failed (500)", 500));
    render(<NotificationBell />);
    await userEvent.click(await screen.findByRole("button", { name: /Notifications/ }));
    await userEvent.click(await screen.findByText('Boss Person assigned you "Launch"'));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not mark the notification as read.",
    );
  });

  it("marks everything read with one click and clears the number", async () => {
    countMock.mockResolvedValue(2);
    listMock.mockResolvedValue({
      items: [note(), note({ id: "n2", record_name: "Ship" })],
      next_cursor: null,
    });
    readAllMock.mockImplementation(async () => {
      countMock.mockResolvedValue(0); // from now on the server says nothing is unread
      return 0;
    });
    render(<NotificationBell />);
    await userEvent.click(await screen.findByRole("button", { name: /Notifications/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Mark all as read" }));

    expect(readAllMock).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Notifications, 0 unread" })).toBeVisible(),
    );
    // Nothing is left to mark, so the button goes away.
    expect(screen.queryByRole("button", { name: "Mark all as read" })).not.toBeInTheDocument();
  });

  it("offers no 'mark all' when nothing is unread", async () => {
    countMock.mockResolvedValue(0);
    listMock.mockResolvedValue({
      items: [note({ read_at: "2026-11-13T11:00:00Z" })],
      next_cursor: null,
    });
    render(<NotificationBell />);
    await userEvent.click(await screen.findByRole("button", { name: /Notifications/ }));
    await screen.findByText('Boss Person assigned you "Launch"');
    expect(screen.queryByRole("button", { name: "Mark all as read" })).not.toBeInTheDocument();
  });

  it("shows an error when marking everything read fails", async () => {
    countMock.mockResolvedValue(1);
    listMock.mockResolvedValue({ items: [note()], next_cursor: null });
    readAllMock.mockRejectedValue(new ApiError("Request failed (500)", 500));
    render(<NotificationBell />);
    await userEvent.click(await screen.findByRole("button", { name: /Notifications/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Mark all as read" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not mark the notifications as read.",
    );
  });
});
