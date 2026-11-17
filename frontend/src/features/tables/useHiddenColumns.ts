"use client";

import { useCallback, useState } from "react";

import { readStored, removeStored, writeStored } from "@/lib/storage";

const key = (tableId: string) => `table-hidden-columns:${tableId}`;

function read(tableId: string): string[] {
  try {
    const parsed: unknown = JSON.parse(readStored(key(tableId)) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    // No window (server), blocked storage or broken JSON: start with every column shown.
    return [];
  }
}

function write(tableId: string, hidden: string[]) {
  if (hidden.length === 0) removeStored(key(tableId));
  else writeStored(key(tableId), JSON.stringify(hidden));
}

/**
 * The columns this person hid in a table. Kept in the browser per table, so a reload (or coming
 * back later) shows the same columns. It lives in this browser only. "Save as a view" keeps a
 * choice on the server instead (with the filter and sort), so it follows the person to any device.
 */
export function useHiddenColumns(tableId: string): [string[], (hidden: string[]) => void] {
  const [store, setStore] = useState(() => ({ tableId, hidden: read(tableId) }));
  let current = store;
  if (store.tableId !== tableId) {
    // Another table was opened in the same screen: load its own choice.
    current = { tableId, hidden: read(tableId) };
    setStore(current);
  }
  const set = useCallback(
    (hidden: string[]) => {
      write(tableId, hidden);
      setStore({ tableId, hidden });
    },
    [tableId],
  );
  return [current.hidden, set];
}
