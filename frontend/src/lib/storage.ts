/**
 * What a person chose, remembered in this browser only. It is a convenience, so every failure
 * (no window on the server, blocked or full storage) just means nothing is remembered.
 */

export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // not remembered
  }
}

export function removeStored(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // not removed
  }
}
