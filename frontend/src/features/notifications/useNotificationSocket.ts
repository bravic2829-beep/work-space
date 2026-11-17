"use client";

import { useEffect, useRef, useState } from "react";

import { emitLiveChange } from "./liveRefresh";

export type SocketStatus = "connecting" | "online" | "offline";

/** The server closes with this code when the session ended: signing in again is needed. */
const SESSION_ENDED = 4401;
const MAX_DELAY_MS = 30_000;
/** Many edits in a burst make one re-read, not one each. */
const RECORDS_DEBOUNCE_MS = 300;

/**
 * Keeps one WebSocket open to `/api/v1/ws` and calls `onChanged` whenever the server says the
 * notifications changed (and tells the open lists when a record they may show changed), and again each time the connection (re)opens, so whatever was missed
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
    let wasDown = false;
    let recordsTimer: ReturnType<typeof setTimeout> | undefined;

    function connect() {
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${scheme}://${window.location.host}/api/v1/ws`);
      socket.onopen = () => {
        attempt = 0;
        setStatus("online");
        callback.current("connected");
        // After a drop, whatever happened while offline is fetched again by the open screens.
        if (wasDown) emitLiveChange();
        wasDown = false;
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
            emitLiveChange();
          } else if (
            typeof message === "object" &&
            message !== null &&
            (message as { type?: unknown }).type === "records.changed"
          ) {
            // A task somebody can see was changed: the open lists read themselves again.
            clearTimeout(recordsTimer);
            recordsTimer = setTimeout(emitLiveChange, RECORDS_DEBOUNCE_MS);
          }
        } catch {
          /* not a message we know: ignore it */
        }
      };
      socket.onclose = (event: CloseEvent) => {
        setStatus("offline");
        wasDown = true;
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
      clearTimeout(recordsTimer);
      socket?.close();
    };
  }, []);

  return status;
}
