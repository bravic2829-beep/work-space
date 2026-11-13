"use client";

import { useEffect, useRef, useState } from "react";

export type SocketStatus = "connecting" | "online" | "offline";

/** The server closes with this code when the session ended: signing in again is needed. */
const SESSION_ENDED = 4401;
const MAX_DELAY_MS = 30_000;

/**
 * Keeps one WebSocket open to `/api/v1/ws` and calls `onChanged` whenever the server says the
 * notifications changed, and again each time the connection (re)opens, so whatever was missed
 * while offline is fetched. The socket only carries a signal; the data comes from the API.
 * After a drop it reconnects with a growing delay.
 */
export function useNotificationSocket(
  onChanged: (cause: "signal" | "connected") => void,
): SocketStatus {
  const [status, setStatus] = useState<SocketStatus>("connecting");
  const callback = useRef(onChanged);

  useEffect(() => {
    callback.current = onChanged;
  });

  useEffect(() => {
    if (typeof WebSocket === "undefined") return;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let stopped = false;

    function connect() {
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${scheme}://${window.location.host}/api/v1/ws`);
      socket.onopen = () => {
        attempt = 0;
        setStatus("online");
        callback.current("connected");
      };
      socket.onmessage = (event: MessageEvent) => {
        try {
          const message: unknown = JSON.parse(String(event.data));
          if (
            typeof message === "object" &&
            message !== null &&
            (message as { type?: unknown }).type === "notifications.changed"
          ) {
            callback.current("signal");
          }
        } catch {
          /* not a message we know: ignore it */
        }
      };
      socket.onclose = (event: CloseEvent) => {
        setStatus("offline");
        if (stopped || event.code === SESSION_ENDED) return;
        const delay = Math.min(MAX_DELAY_MS, 1000 * 2 ** attempt);
        attempt += 1;
        timer = setTimeout(connect, delay);
      };
    }

    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, []);

  return status;
}
