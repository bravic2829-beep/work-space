"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { errorMessage } from "@/lib/api/errors";

import { getGroups, listRecords } from "./api";
import { groupKey } from "./groups";
import type {
  Condition,
  Group,
  GroupBucket,
  GroupsResult,
  RecordItem,
  SortColumn,
  ViewTotal,
} from "./schema";

/** The groups open when the table is first grouped; the person opens the others one by one. */
export const AUTO_OPEN = 5;

export type GroupRows = {
  items: RecordItem[];
  next: string | null;
  loading: boolean;
  error: string | null;
  /** Which load these rows belong to; rows of an older load are read again. */
  gen: string;
};

type Params = {
  enabled: boolean;
  tableId: string;
  groupBy: string;
  bucket: GroupBucket | null;
  totals: ViewTotal[];
  filter: Condition[];
  sort: SortColumn[];
  /** A number that goes up when the table must be read again (a change, a live update). */
  refreshKey: number;
};

type Loaded =
  | { status: "loading"; error: null; result: null; version: number; config: string }
  | { status: "error"; error: unknown; result: null; version: number; config: string }
  | { status: "ready"; error: null; result: GroupsResult; version: number; config: string };

export type GroupedRecords = {
  status: Loaded["status"];
  error: unknown;
  groups: Group[];
  total: number;
  truncated: boolean;
  rows: ReadonlyMap<string, GroupRows>;
  open: ReadonlySet<string>;
  /** Every record loaded so far, once each (a record in two groups is one record). */
  items: RecordItem[];
  toggle: (key: string) => void;
  loadMore: (key: string) => Promise<void>;
  /** A record came back from the server changed. */
  replace: (record: RecordItem) => void;
  remove: (id: string) => void;
};

const NONE: Loaded = { status: "loading", error: null, result: null, version: 0, config: "" };

/**
 * The records of a table folded into groups: the groups with their counts and totals first, then
 * the rows of each group that is open, a page at a time. Old data stays on screen while a newer
 * read is on its way, so a change does not make the table flash.
 */
export function useGroupedRecords(params: Params): GroupedRecords {
  const { enabled, tableId, groupBy, bucket, totals, refreshKey } = params;
  const [loaded, setLoaded] = useState<Loaded>(NONE);
  const [rows, setRows] = useState<ReadonlyMap<string, GroupRows>>(new Map());
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const filterKey = JSON.stringify(params.filter);
  const sortKey = JSON.stringify(params.sort);
  const totalsKey = JSON.stringify(totals);
  const config = `${tableId}|${groupBy}|${bucket ?? ""}|${totalsKey}`;

  // The latest filter and sort, for effects that must not run again only because they changed.
  const latest = useRef({ filter: params.filter, sort: params.sort });
  latest.current = { filter: params.filter, sort: params.sort };
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const openedFor = useRef("");

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    async function load() {
      try {
        const result = await getGroups(
          tableId,
          { groupBy, bucket, totals, filter: latest.current.filter },
          controller.signal,
        );
        if (openedFor.current !== config) {
          openedFor.current = config;
          setRows(new Map());
          setOpen(new Set(result.groups.slice(0, AUTO_OPEN).map(groupKey)));
        } else {
          const keys = new Set(result.groups.map(groupKey));
          setOpen((current) => new Set([...current].filter((key) => keys.has(key))));
        }
        setLoaded((current) => ({
          status: "ready",
          error: null,
          result,
          version: current.version + 1,
          config,
        }));
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoaded((current) => ({
          status: "error",
          error,
          result: null,
          version: current.version + 1,
          config,
        }));
      }
    }
    // A different grouping starts from nothing; the same one keeps its old groups meanwhile.
    setLoaded((current) => (current.config === config ? current : { ...NONE, config }));
    void load();
    return () => controller.abort();
    // `totals` is read through its key: a new array with the same content is not a change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, tableId, groupBy, bucket, totalsKey, filterKey, refreshKey, config]);

  const result = loaded.status === "ready" && loaded.config === config ? loaded.result : null;
  const version = loaded.version;

  useEffect(() => {
    if (!enabled || !result) return;
    const controller = new AbortController();
    const gen = `${version}|${sortKey}`;
    for (const group of result.groups) {
      const key = groupKey(group);
      const filter = group.filter;
      if (!open.has(key) || filter === null) continue;
      const current = rowsRef.current.get(key);
      if (current && current.gen === gen && !current.loading) continue;
      setRows((all) =>
        new Map(all).set(key, {
          items: current?.items ?? [],
          next: current?.next ?? null,
          loading: true,
          error: null,
          gen,
        }),
      );
      listRecords(
        tableId,
        { filter: [...latest.current.filter, ...filter], sort: latest.current.sort },
        controller.signal,
      )
        .then((page) =>
          setRows((all) =>
            new Map(all).set(key, {
              items: page.items,
              next: page.next_cursor,
              loading: false,
              error: null,
              gen,
            }),
          ),
        )
        .catch((error) => {
          if (controller.signal.aborted) return;
          setRows((all) =>
            new Map(all).set(key, {
              items: [],
              next: null,
              loading: false,
              error: errorMessage(error, "Could not load these records."),
              gen,
            }),
          );
        });
    }
    return () => controller.abort();
  }, [enabled, tableId, result, version, open, sortKey]);

  const toggle = useCallback((key: string) => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    // Opening a group whose rows failed to load tries again.
    setRows((all) => {
      if (!all.get(key)?.error) return all;
      const next = new Map(all);
      next.delete(key);
      return next;
    });
  }, []);

  const loadMore = useCallback(
    async (key: string) => {
      const group = result?.groups.find((g) => groupKey(g) === key);
      const current = rowsRef.current.get(key);
      if (!group?.filter || !current?.next || current.loading) return;
      setRows((all) => new Map(all).set(key, { ...current, loading: true }));
      try {
        const page = await listRecords(tableId, {
          filter: [...latest.current.filter, ...group.filter],
          sort: latest.current.sort,
          cursor: current.next,
        });
        setRows((all) =>
          new Map(all).set(key, {
            ...current,
            items: [...current.items, ...page.items],
            next: page.next_cursor,
            loading: false,
          }),
        );
      } catch (error) {
        setRows((all) =>
          new Map(all).set(key, {
            ...current,
            loading: false,
            error: errorMessage(error, "Could not load more records."),
          }),
        );
      }
    },
    [result, tableId],
  );

  const replace = useCallback((record: RecordItem) => {
    setRows((all) => {
      const next = new Map<string, GroupRows>();
      for (const [key, value] of all) {
        next.set(key, {
          ...value,
          items: value.items.map((item) => (item.id === record.id ? record : item)),
        });
      }
      return next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setRows((all) => {
      const next = new Map<string, GroupRows>();
      for (const [key, value] of all) {
        next.set(key, { ...value, items: value.items.filter((item) => item.id !== id) });
      }
      return next;
    });
  }, []);

  const items = useMemo(() => {
    const seen = new Set<string>();
    const all: RecordItem[] = [];
    for (const value of rows.values()) {
      for (const item of value.items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        all.push(item);
      }
    }
    return all;
  }, [rows]);

  return {
    status: !enabled ? "loading" : result ? "ready" : loaded.status === "error" ? "error" : "loading",
    error: loaded.error,
    groups: result?.groups ?? [],
    total: result?.total ?? 0,
    truncated: result?.truncated ?? false,
    rows,
    open,
    items,
    toggle,
    loadMore,
    replace,
    remove,
  };
}
