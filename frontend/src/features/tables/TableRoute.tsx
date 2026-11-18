"use client";

import { useSearchParams } from "next/navigation";

import { TableWithSheets } from "@/features/sheets/TableWithSheets";
import { localToday } from "@/features/mytasks/schema";

import { isPreset } from "./presets";


/**
 * The page of one table. `?show=overdue` (and `&person=<user id>`) opens it with a ready-made
 * filter: that is where the numbers of the Reports page lead.
 */
export function TableRoute({ tableId }: { tableId: string }) {
  const params = useSearchParams();
  const show = params.get("show");
  const preset = isPreset(show)
    ? { show, person: params.get("person"), today: localToday() }
    : undefined;
  return <TableWithSheets tableId={tableId} preset={preset} />;
}
