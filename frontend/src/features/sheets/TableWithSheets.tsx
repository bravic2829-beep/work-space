"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { LoadingState } from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { TableScreen } from "@/features/tables/TableScreen";
import type { Preset } from "@/features/tables/presets";
import { readStored, writeStored } from "@/lib/storage";

import { listSheets } from "./api";
import { CreateSheetDrawer } from "./CreateSheetDrawer";
import type { SheetItem } from "./schema";
import { ShareSheetDrawer } from "./ShareSheetDrawer";
import { ALL_TASKS, SheetTabs } from "./SheetTabs";

type TablePreset = { show: Preset; person?: string | null; today: string };

const PINS_KEY = "workbase.work.pins";
const lastKey = (tableId: string) => `workbase.work.last.${tableId}`;

function readPins(): string[] {
  try {
    const parsed: unknown = JSON.parse(readStored(PINS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** The tab to open first: "All tasks" for somebody who sees them all, else the person's own sheet. */
function firstTab(sheets: SheetItem[], showAll: boolean, me: string): string {
  if (showAll) return ALL_TASKS;
  return (sheets.find((s) => s.owner.id === me) ?? sheets[0]).id;
}

/**
 * One table of tasks, with the sheets made on it. "All tasks" is the whole table (for admins and
 * members of its workspace); each other tab is one person's sheet, with only the controls the
 * person's role on that sheet allows. A tab is the same data as the table, so a change made in
 * one tab shows in the others. A table nobody made a sheet on is just the table, without tabs.
 */
export function TableWithSheets({ tableId, preset }: { tableId: string; preset?: TablePreset }) {
  const { state: auth } = useAuth();
  const me = auth.status === "authenticated" ? auth.user.id : "";

  // null while loading; an empty list when the person has no sheet here (or they could not load).
  const [loaded, setLoaded] = useState<SheetItem[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [showShare, setShowShare] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [pins, setPins] = useState<string[]>(readPins);

  const [loadKey, setLoadKey] = useState(0);
  // Asking again keeps the sheets on screen until the new list arrives.
  const reload = useCallback(() => setLoadKey((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const all = await listSheets(controller.signal);
        setLoaded(all.filter((s) => s.table_id === tableId));
      } catch {
        if (controller.signal.aborted) return;
        // Sheets are an extra: if they cannot be listed the table itself still opens.
        setLoaded((current) => current ?? []);
      }
    }
    void load();
    return () => controller.abort();
  }, [tableId, loadKey]);

  const sheets = useMemo(() => {
    // Pinned sheets first, in the order they were pinned; the rest as the server listed them.
    return [...(loaded ?? [])].sort((a, b) => {
      const pa = pins.indexOf(a.id);
      const pb = pins.indexOf(b.id);
      if (pa === -1 && pb === -1) return 0;
      if (pa === -1) return 1;
      if (pb === -1) return -1;
      return pa - pb;
    });
  }, [loaded, pins]);

  if (loaded === null) return <LoadingState>Loading…</LoadingState>;

  if (sheets.length === 0) {
    return <TableScreen key="plain" tableId={tableId} preset={preset} onSheetsChanged={reload} />;
  }

  const showAll = sheets.some((s) => s.can_see_all);
  const isValid = (id: string | null) =>
    id !== null && (id === ALL_TASKS ? showAll : sheets.some((s) => s.id === id));
  // A ready-made filter (from Reports) belongs to the whole table, so it opens that tab.
  const wanted = preset && showAll ? ALL_TASKS : null;
  // What was chosen now, else the tab open last time in this browser, else the natural first.
  const remembered = readStored(lastKey(tableId));
  const active = isValid(chosen)
    ? (chosen as string)
    : isValid(wanted)
      ? (wanted as string)
      : isValid(remembered)
        ? (remembered as string)
        : firstTab(sheets, showAll, me);

  function choose(id: string) {
    setChosen(id);
    writeStored(lastKey(tableId), id);
  }

  function togglePin(id: string) {
    const next = pins.includes(id) ? pins.filter((p) => p !== id) : [...pins, id];
    setPins(next);
    writeStored(PINS_KEY, JSON.stringify(next));
  }

  const sheet = sheets.find((s) => s.id === active);
  const canMake = sheets.some((s) => s.is_admin);

  return (
    <div className="flex flex-col gap-3">
      <SheetTabs
        sheets={sheets}
        showAll={showAll}
        active={active}
        onSelect={choose}
        onCreate={canMake ? () => setShowCreate(true) : undefined}
        pinned={new Set(pins)}
        onTogglePin={togglePin}
      />

      <TableScreen
        key={active}
        tableId={tableId}
        sheet={sheet}
        preset={sheet ? undefined : preset}
        onShare={sheet ? () => setShowShare(true) : undefined}
        onSheetsChanged={reload}
      />

      {showShare && sheet && (
        <ShareSheetDrawer
          sheet={sheet}
          onClose={() => setShowShare(false)}
          onMembersChanged={reload}
          onRenamed={reload}
          onArchived={() => {
            setShowShare(false);
            setChosen(null);
            reload();
          }}
        />
      )}
      {showCreate && (
        <CreateSheetDrawer
          tableId={tableId}
          onClose={() => setShowCreate(false)}
          onCreated={(created) => {
            choose(created.id);
            reload();
          }}
        />
      )}
    </div>
  );
}
