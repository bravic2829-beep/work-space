import type {
  FieldItem,
  FieldType,
  RecordItem,
  Role,
  TableDetail,
  ViewItem,
  WorkspaceItem,
} from "./schema";

export function makeField(
  id: string,
  name: string,
  type: FieldType,
  overrides: Partial<FieldItem> = {},
): FieldItem {
  return {
    id,
    table_id: "t-1",
    name,
    type,
    config: {},
    semantic: null,
    grants_view: false,
    is_required: false,
    position: 0,
    access: "edit",
    ...overrides,
  };
}

export const NAME = makeField("f-name", "Name", "text");
export const POINTS = makeField("f-points", "Points", "number", { config: { precision: 0 } });
export const DONE = makeField("f-done", "Done", "checkbox");
export const PRIORITY = makeField("f-priority", "Priority", "single_select", {
  config: {
    options: [
      { id: "o-high", name: "High" },
      { id: "o-low", name: "Low" },
    ],
  },
});
export const TAGS = makeField("f-tags", "Tags", "multi_select", {
  config: {
    options: [
      { id: "o-x", name: "x" },
      { id: "o-y", name: "y" },
    ],
  },
});
export const DUE = makeField("f-due", "Due date", "date", { config: { include_time: false } });
export const ASSIGNEE = makeField("f-assignee", "Assignee", "user", {
  config: { multiple: true },
  semantic: "assignee",
  grants_view: true,
});
export const CREATED = makeField("f-created", "Created time", "created_time");
export const AUTHOR = makeField("f-author", "Author", "created_by");

export const FIELDS: FieldItem[] = [NAME, POINTS, DONE, PRIORITY, TAGS, DUE, ASSIGNEE, CREATED].map(
  (field, position) => ({ ...field, position }),
);

export function makeTable(
  role: Role | null = "editor",
  fields: FieldItem[] = FIELDS,
): TableDetail {
  // Like the API: only editors and admins get edit access to columns by default.
  const canEdit = role === "editor" || role === "admin";
  return {
    id: "t-1",
    base_id: "b-1",
    name: "Tasks",
    fields: canEdit ? fields : fields.map((field) => ({ ...field, access: "read" as const })),
    my_role: role,
  };
}

export function makeRecord(
  id: string,
  data: Record<string, unknown>,
  overrides: Partial<RecordItem> = {},
): RecordItem {
  return {
    id,
    table_id: "t-1",
    data,
    created_by: "u-me",
    created_at: "2026-11-13T01:00:00Z",
    updated_at: "2026-11-13T01:00:00Z",
    version: 1,
    ...overrides,
  };
}

export function makeView(id: string, name: string, config: Partial<ViewItem["config"]> = {}): ViewItem {
  return {
    id,
    table_id: "t-1",
    name,
    config: { filter: [], sort: [], hidden_fields: [], ...config },
  };
}

export function makeWorkspace(
  id: string,
  name: string,
  role: Role = "editor",
  kind: "shared" | "personal" = "shared",
): WorkspaceItem {
  return { id, name, kind, owner_user_id: kind === "personal" ? "u-me" : null, my_role: role };
}
