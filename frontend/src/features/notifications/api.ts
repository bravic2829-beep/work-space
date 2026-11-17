import { API, apiRequest } from "@/lib/api/client";

import {
  isNotification,
  isNotificationPage,
  isUnreadCount,
  type Notification,
  type NotificationPage,
} from "./schema";

export function listNotifications(limit: number, signal?: AbortSignal): Promise<NotificationPage> {
  return apiRequest("GET", `${API}/notifications?limit=${limit}`, {
    guard: isNotificationPage,
    signal,
  });
}

export async function getUnreadCount(signal?: AbortSignal): Promise<number> {
  const result = await apiRequest("GET", `${API}/notifications/unread-count`, {
    guard: isUnreadCount,
    signal,
  });
  return result.unread;
}

export function setNotificationRead(id: string, read: boolean): Promise<Notification> {
  return apiRequest("PATCH", `${API}/notifications/${id}`, {
    body: { read },
    guard: isNotification,
  });
}

/** Marks all of my notifications read. Returns the new unread count. */
export async function markAllNotificationsRead(): Promise<number> {
  const result = await apiRequest("POST", `${API}/notifications/read-all`, {
    guard: isUnreadCount,
  });
  return result.unread;
}
