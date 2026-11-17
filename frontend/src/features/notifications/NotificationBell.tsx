"use client";

import { Bell, ClipboardCheck, Undo2, UserPlus, WifiOff, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, Button } from "@/components/ui";

import {
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  setNotificationRead,
} from "./api";
import { describe, type Notification, type NotificationType } from "./schema";
import { useNotificationSocket } from "./useNotificationSocket";
import { formatDateTime } from "@/lib/format";

/**
 * The live socket brings news at once. This slow refresh is only a safety net for the time the
 * socket is down or blocked (some networks drop WebSockets).
 */
const FALLBACK_REFRESH_MS = 60_000;
const TOAST_MS = 6_000;
const PAGE_SIZE = 20;

const ICONS: Record<NotificationType, LucideIcon> = {
  task_assigned: UserPlus,
  review_requested: ClipboardCheck,
  changes_requested: Undo2,
};

/** The bell in the header: a number of unread notifications, the list behind it and live news. */
export function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const known = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // The bell must never break the page: when the count cannot be loaded it keeps the old number.
  const refresh = useCallback(async (announce: boolean, signal?: AbortSignal) => {
    try {
      const count = await getUnreadCount(signal);
      if (signal?.aborted) return;
      if (announce && count > known.current) {
        setToast("You have a new notification.");
        clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
      }
      known.current = count;
      setUnread(count);
    } catch {
      /* keep the old number */
    }
  }, []);

  const socket = useNotificationSocket((cause) => void refresh(cause === "signal"));

  useEffect(() => {
    const controller = new AbortController();

    async function poll() {
      try {
        const count = await getUnreadCount(controller.signal);
        if (controller.signal.aborted) return;
        known.current = count;
        setUnread(count);
      } catch {
        /* keep the old number */
      }
    }

    void poll();
    const timer = setInterval(() => void poll(), FALLBACK_REFRESH_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
      clearTimeout(toastTimer.current);
    };
  }, []);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;
    setError(null);
    try {
      const page = await listNotifications(PAGE_SIZE);
      setItems(page.items);
      await refresh(false);
    } catch {
      setError("Could not load notifications.");
    }
  }

  async function markRead(notification: Notification) {
    if (notification.read_at !== null) return;
    try {
      const updated = await setNotificationRead(notification.id, true);
      setItems((current) =>
        current === null ? current : current.map((n) => (n.id === updated.id ? updated : n)),
      );
      await refresh(false);
    } catch {
      setError("Could not mark the notification as read.");
    }
  }

  async function markAllRead() {
    setError(null);
    try {
      await markAllNotificationsRead();
      const now = new Date().toISOString();
      setItems((current) =>
        current === null ? current : current.map((n) => (n.read_at === null ? { ...n, read_at: now } : n)),
      );
      await refresh(false);
    } catch {
      setError("Could not mark the notifications as read.");
    }
  }

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        aria-expanded={open}
        aria-label={`Notifications, ${unread} unread`}
        onClick={() => void toggle()}
        className="relative"
      >
        <Bell className="size-[1.15rem]" aria-hidden />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 flex min-w-4.5 items-center justify-center rounded-full bg-danger px-1 text-[0.65rem] leading-4.5 font-semibold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Button>
      {socket === "offline" && (
        <p
          role="status"
          className="absolute top-full right-0 z-20 m-0 mt-1 flex w-max items-center gap-1.5 rounded-md bg-warning-soft px-2 py-1 text-xs text-warning"
        >
          <WifiOff className="size-3.5" aria-hidden />
          <span>Live updates paused, reconnecting…</span>
        </p>
      )}
      {toast && (
        <p
          role="status"
          className="fixed right-6 bottom-6 z-40 m-0 flex items-center gap-2 rounded-lg bg-fg px-4 py-3 text-sm text-bg shadow-lg"
        >
          <Bell className="size-4" aria-hidden />
          <span>{toast}</span>
        </p>
      )}
      {open && (
        <div
          className="absolute top-full right-0 z-30 mt-2 w-96 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-line bg-surface shadow-lg"
          role="region"
          aria-label="Notifications"
        >
          {unread > 0 && (
            <div className="flex justify-end border-b border-line px-3 py-2">
              <Button size="sm" variant="ghost" onClick={() => void markAllRead()}>
                Mark all as read
              </Button>
            </div>
          )}
          <div className="max-h-96 overflow-y-auto">
            {error && (
              <div className="p-3">
                <Alert>{error}</Alert>
              </div>
            )}
            {items === null && !error && <p className="m-0 p-4 text-sm text-muted">Loading...</p>}
            {items !== null && items.length === 0 && (
              <p className="m-0 p-6 text-center text-sm text-muted">No notifications.</p>
            )}
            {items !== null && items.length > 0 && (
              <ul className="m-0 list-none divide-y divide-line p-0">
                {items.map((n) => {
                  const Icon = ICONS[n.type];
                  const isUnread = n.read_at === null;
                  return (
                    <li key={n.id} className={isUnread ? "bg-primary-soft/50" : undefined}>
                      <Link
                        href={`/tables/${n.table_id}`}
                        onClick={() => void markRead(n)}
                        className="flex items-start gap-3 px-4 py-3 text-fg no-underline hover:bg-surface-muted hover:no-underline"
                      >
                        <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span
                            className={isUnread ? "block text-sm font-semibold" : "block text-sm"}
                          >
                            {describe(n)}
                          </span>
                          <small className="block">{formatDateTime(n.created_at)}</small>
                        </span>
                        {isUnread && (
                          <span
                            className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
                            aria-hidden
                          />
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
