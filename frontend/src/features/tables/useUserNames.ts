"use client";

import { useEffect, useState } from "react";

import { plainName } from "@/components/ui";

import { lookupUsers } from "./api";

// People never change their name in the middle of a session in a way that matters, so one cache
// for the whole page is enough and saves a request for every table that names the same people.
const names = new Map<string, string>();

export function resetUserNames(): void {
  names.clear();
}

export function userLabel(user: { full_name: string; employee_code: string }): string {
  return `${user.full_name} (${user.employee_code})`;
}

/** The name and the employee code inside a label made by `userLabel`. */
export function labelParts(label: string): { name: string; code: string | null } {
  const code = /\(([^)]+)\)\s*$/.exec(label)?.[1] ?? null;
  return { name: plainName(label), code };
}

/** Remembers the label of a person that was found some other way (for example by searching). */
export function rememberUser(id: string, label: string): void {
  names.set(id, label);
}

/** id -> "Name (CODE)" for the given ids. Missing names are fetched and the caller re-renders. */
export function useUserNames(ids: string[]): ReadonlyMap<string, string> {
  const [, refresh] = useState(0);
  const key = [...new Set(ids)].sort().join(",");

  useEffect(() => {
    const missing = key === "" ? [] : key.split(",").filter((id) => !names.has(id));
    if (missing.length === 0) return;
    let cancelled = false;

    async function load() {
      try {
        for (let start = 0; start < missing.length; start += 100) {
          const chunk = missing.slice(start, start + 100);
          const found = await lookupUsers(chunk);
          for (const user of found) names.set(user.id, userLabel(user));
          for (const id of chunk) if (!names.has(id)) names.set(id, "Unknown employee");
        }
      } catch {
        return; // the cells keep showing "…" and the next render tries again
      }
      if (!cancelled) refresh((n) => n + 1);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [key]);

  return names;
}
