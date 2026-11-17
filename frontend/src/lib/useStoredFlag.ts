"use client";

import { useCallback, useState } from "react";

import { readStored, removeStored, writeStored } from "./storage";

/**
 * A yes/no choice remembered in this browser under `key`. When `key` changes (another table was
 * opened in the same screen) the choice stored for the new key is read.
 */
export function useStoredFlag(key: string): [boolean, (value: boolean) => void] {
  const [store, setStore] = useState(() => ({ key, value: readStored(key) === "1" }));
  let current = store;
  if (store.key !== key) {
    current = { key, value: readStored(key) === "1" };
    setStore(current);
  }
  const set = useCallback(
    (value: boolean) => {
      if (value) writeStored(key, "1");
      else removeStored(key);
      setStore({ key, value });
    },
    [key],
  );
  return [current.value, set];
}
