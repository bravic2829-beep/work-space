import { isRecord, pageOf } from "@/lib/api/guards";

export type TrashItem = {
  id: string;
  table_id: string;
  table_name: string;
  /** Null when the name column is hidden from this person. */
  name: string | null;
  deleted_at: string;
  purge_at: string;
};

export type TrashPage = { items: TrashItem[]; next_cursor: string | null };

export function isTrashItem(value: unknown): value is TrashItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.table_id === "string" &&
    typeof value.table_name === "string" &&
    (value.name === null || typeof value.name === "string") &&
    typeof value.deleted_at === "string" &&
    typeof value.purge_at === "string"
  );
}

export const isTrashPage = pageOf(isTrashItem);

export type FileTrashItem = {
  id: string;
  name: string;
  deleted_by: string;
  deleted_at: string;
  purge_at: string;
  original: {
    table_id: string;
    table_name: string;
    record_name: string | null;
    field_name: string;
  } | null;
  can_restore: boolean;
  can_delete_forever: boolean;
};

function isFileTrashItem(value: unknown): value is FileTrashItem {
  if (!isRecord(value)) return false;
  const original = value.original;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.deleted_by === "string" &&
    typeof value.deleted_at === "string" &&
    typeof value.purge_at === "string" &&
    typeof value.can_restore === "boolean" &&
    typeof value.can_delete_forever === "boolean" &&
    (original === null ||
      (isRecord(original) &&
        typeof original.table_id === "string" &&
        typeof original.table_name === "string" &&
        (original.record_name === null || typeof original.record_name === "string") &&
        typeof original.field_name === "string"))
  );
}

export type FileTrashPage = { items: FileTrashItem[]; next_cursor: string | null };
export const isFileTrashPage = pageOf(isFileTrashItem);

/** A record that was restored: all we need is that the server answered with a record. */
export function isRestoredRecord(value: unknown): value is { id: string } {
  return isRecord(value) && typeof value.id === "string";
}
