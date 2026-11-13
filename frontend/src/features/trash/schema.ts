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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

export function isTrashPage(value: unknown): value is TrashPage {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every(isTrashItem) &&
    (value.next_cursor === null || typeof value.next_cursor === "string")
  );
}

/** A record that was restored: all we need is that the server answered with a record. */
export function isRestoredRecord(value: unknown): value is { id: string } {
  return isRecord(value) && typeof value.id === "string";
}
