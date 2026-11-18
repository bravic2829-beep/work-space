"use client";

import { FolderKanban } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert, Button, EmptyState, LoadingState, Select } from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { isOrgAdmin } from "@/features/auth/schema";
import { TableScreen } from "@/features/tables/TableScreen";

import { listSheets } from "./api";
import { CreateSheetDrawer } from "./CreateSheetDrawer";
import type { SheetItem } from "./schema";
import { ShareSheetDrawer } from "./ShareSheetDrawer";
import { ALL_TASKS, SheetTabs } from "./SheetTabs";
import { errorMessage } from "@/lib/api/errors";
import { readStored, writeStored } from "@/lib/storage";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; sheets: SheetItem[] };

/** The tab to open first: "All tasks" for somebody who sees them all, else the person's own sheet. */
function firstTab(sheets: SheetItem[], showAll: boolean, me: string): string {
  if (showAll) return ALL_TASKS;
  return (sheets.find((s) => s.owner.id === me) ?? sheets[0]).id;
}

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

/**
 * Work summary: one table of tasks seen through sheets. "All tasks" is the whole table (for
 * admins and members of its workspace); each other tab is one person's sheet, with only the
 * controls the person's role on that sheet allows. A tab is the same data as the table, so a
 * change made in one place shows in the other.
 */
export function WorkScreen() {
  const { state: auth } = useAuth();
  const me = auth.status === "authenticated" ? auth.user.id : "";
  const admin = auth.status === "authenticated" && isOrgAdmin(auth.user);

  const [state, setState] = useState<State>({ kind: "loading" });
  const [tableId, setTableId] = useState<string | null>(null);
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
        setState({ kind: "ready", sheets: await listSheets(controller.signal) });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          kind: "error",
          message: errorMessage(error, "Could not load the sheets."),
        });
      }
    }
    void load();
    return () => controller.abort();
  }, [loadKey]);

  const sheets = useMemo(() => (state.kind === "ready" ? state.sheets : []), [state]);
  const tables = useMemo(() => {
    const seen = new Map<string, string>();
    for (const sheet of sheets) if (!seen.has(sheet.table_id)) seen.set(sheet.table_id, sheet.table_name);
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [sheets]);

  if (state.kind === "loading") return <LoadingState>Loading…</LoadingState>;
  if (state.kind === "error") {
    return (
      <Alert>
        <span className="mr-2">{state.message}</span>
        <Button size="sm" onClick={reload}>
          Try again
        </Button>
      </Alert>
    );
  }

  if (sheets.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="sr-only">Work summary</h1>
        <EmptyState icon={FolderKanban} title="No sheets yet.">
          {admin ? (
            <>
              A sheet gives one person their own view of a task table. Open a task table and press{" "}
              <b>Create sheet</b>. <Link href="/workspaces">Go to workspaces</Link>
            </>
          ) : (
            "Nobody has shared a sheet with you yet. Ask an admin to give you one."
          )}
        </EmptyState>
      </div>
    );
  }

  const currentTable = tables.find((t) => t.id === tableId)?.id ?? tables[0].id;
  // Pinned sheets first, in the order they were pinned; the rest by name.
  const pinned = new Set(pins);
  const tabSheets = sheets
    .filter((s) => s.table_id === currentTable)
    .sort((a, b) => {
      const pa = pins.indexOf(a.id);
      const pb = pins.indexOf(b.id);
      if (pa === -1 && pb === -1) return 0;
      if (pa === -1) return 1;
      if (pb === -1) return -1;
      return pa - pb;
    });
  const showAll = tabSheets.some((s) => s.can_see_all);
  const isValid = (id: string | null) =>
    id !== null && (id === ALL_TASKS ? showAll : tabSheets.some((s) => s.id === id));
  // What was chosen now, else the tab open last time in this browser, else the natural first.
  const remembered = readStored(lastKey(currentTable));
  const active = isValid(chosen)
    ? (chosen as string)
    : isValid(remembered)
      ? (remembered as string)
      : firstTab(tabSheets, showAll, me);

  function choose(id: string) {
    setChosen(id);
    writeStored(lastKey(currentTable), id);
  }

  function togglePin(id: string) {
    const next = pins.includes(id) ? pins.filter((p) => p !== id) : [...pins, id];
    setPins(next);
    writeStored(PINS_KEY, JSON.stringify(next));
  }
  const sheet = tabSheets.find((s) => s.id === active);
  const canMake = tabSheets.some((s) => s.is_admin);

  return (
    <div className="flex flex-col gap-3">
      <h1 className="sr-only">Work summary</h1>
      {tables.length > 1 && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[13px] font-medium">
            Table
            <Select
              className="h-8 w-auto py-0 text-[13px]"
              value={currentTable}
              onChange={(event) => {
                setTableId(event.target.value);
                setChosen(null);
              }}
            >
              {tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </label>
        </div>
      )}

      <SheetTabs
        sheets={tabSheets}
        showAll={showAll}
        active={active}
        onSelect={choose}
        onCreate={canMake ? () => setShowCreate(true) : undefined}
        pinned={pinned}
        onTogglePin={togglePin}
      />

      <TableScreen
        key={active}
        tableId={currentTable}
        sheet={sheet}
        onShare={sheet ? () => setShowShare(true) : undefined}
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
          tableId={currentTable}
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
