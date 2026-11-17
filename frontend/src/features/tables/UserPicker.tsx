"use client";

import { useEffect, useState } from "react";

import { searchDirectory } from "./api";
import type { DirectoryUser } from "./schema";
import { rememberUser, useUserNames, userLabel } from "./useUserNames";

type Props = {
  label: string;
  value: string[];
  onChange: (ids: string[]) => void;
  multiple: boolean;
  disabled?: boolean;
};

/** Choose colleagues by searching their code or name (open to every employee). */
export function UserPicker({ label, value, onChange, multiple, disabled }: Props) {
  const names = useUserNames(value);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DirectoryUser[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (disabled || query.trim() === "") return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const found = await searchDirectory(query.trim(), controller.signal);
        for (const user of found) rememberUser(user.id, userLabel(user));
        setResults(found);
      } catch {
        if (!controller.signal.aborted) setResults([]);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, disabled]);

  function add(user: DirectoryUser) {
    onChange(multiple ? [...new Set([...value, user.id])] : [user.id]);
    setQuery("");
    setResults([]);
  }

  return (
    <div>
      <ul className="chips" aria-label={`${label}: chosen`}>
        {value.map((id) => (
          <li key={id}>
            {names.get(id) ?? "…"}
            {!disabled && (
              <button
                type="button"
                aria-label={`Remove ${names.get(id) ?? "employee"}`}
                onClick={() => onChange(value.filter((other) => other !== id))}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      {!disabled && (
        <>
          <input
            type="search"
            className="w-full"
            aria-label={`Find an employee for ${label}`}
            placeholder="Name or code"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {searching && <span role="status"> Searching…</span>}
          {query.trim() !== "" && (
            <ul className="results" aria-label={`${label}: search results`}>
              {results
                .filter((user) => !value.includes(user.id))
                .map((user) => (
                  <li key={user.id}>
                    <button type="button" onClick={() => add(user)}>
                      Add {userLabel(user)}
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
