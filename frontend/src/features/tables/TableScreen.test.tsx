import type { ComponentProps } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchMe } from "@/features/auth/api";
import { AuthProvider } from "@/features/auth/AuthProvider";
import { ApiError } from "@/lib/api/client";
import { sampleUser } from "@/test/fixtures";

import {
  createView,
  deleteRecord,
  deleteView,
  getRecordViewers,
  getTable,
  listRecords,
  listViews,
  lookupUsers,
} from "./api";
import { ASSIGNEE, FIELDS, NAME, makeField, makeRecord, makeTable, makeView } from "./fixtures";
import type { FieldItem, Role } from "./schema";
import { TableScreen } from "./TableScreen";
import { resetUserNames } from "./useUserNames";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/features/auth/api", () => ({ fetchMe: vi.fn(), login: vi.fn(), logout: vi.fn() }));
vi.mock("./api", () => ({
  getTable: vi.fn(),
  listViews: vi.fn(),
  listRecords: vi.fn(),
  createView: vi.fn(),
  deleteView: vi.fn(),
  lookupUsers: vi.fn(),
  searchDirectory: vi.fn(),
  createRecord: vi.fn(),
  updateRecord: vi.fn(),
  deleteRecord: vi.fn(),
  createField: vi.fn(),
  listTables: vi.fn(),
  getRecordViewers: vi.fn(),
}));

const fetchMeMock = vi.mocked(fetchMe);
const getTableMock = vi.mocked(getTable);
const listViewsMock = vi.mocked(listViews);
const listRecordsMock = vi.mocked(listRecords);
const createViewMock = vi.mocked(createView);
const deleteViewMock = vi.mocked(deleteView);
const deleteRecordMock = vi.mocked(deleteRecord);

/** The grid row whose first column is this text. */
function rowOf(text: string): HTMLElement {
  return screen.getByRole("button", { name: `Open record ${text}` }).closest("tr") as HTMLElement;
}
const lookupUsersMock = vi.mocked(lookupUsers);

const alpha = makeRecord("r-1", { "f-name": "Alpha", "f-points": 10, "f-assignee": ["u-2"] });
const beta = makeRecord("r-2", { "f-name": "Beta", "f-points": 5, "f-priority": "o-low" });

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  resetUserNames();
  fetchMeMock.mockResolvedValue(sampleUser({ id: "u-me" }));
  getTableMock.mockResolvedValue(makeTable("editor"));
  listViewsMock.mockResolvedValue([]);
  listRecordsMock.mockResolvedValue({ items: [alpha, beta], next_cursor: null });
  lookupUsersMock.mockResolvedValue([{ id: "u-2", employee_code: "E2", full_name: "Binh" }]);
  vi.mocked(getRecordViewers).mockResolvedValue({
    people: [],
    workspace_name: "Workspace",
    workspace_member_count: 1,
  });
});

async function renderTable(role: Role | null = "editor") {
  getTableMock.mockResolvedValue(makeTable(role));
  const view = render(
    <AuthProvider>
      <TableScreen tableId="t-1" />
    </AuthProvider>,
  );
  await screen.findByRole("heading", { name: "Tasks" });
  await screen.findByText("Alpha");
  return view;
}

function lastQuery() {
  return listRecordsMock.mock.calls.at(-1)?.[1];
}

describe("loading", () => {
  it("shows the columns and the records", async () => {
    await renderTable();
    for (const name of ["Name", "Points", "Done", "Priority", "Tags", "Due date", "Assignee"]) {
      expect(screen.getByRole("columnheader", { name: new RegExp(name) })).toBeInTheDocument();
    }
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Low")).toBeInTheDocument(); // an option shown by its name
    expect(lastQuery()).toEqual({ filter: [], sort: [] });
  });

  it("shows the names of the people it finds in the records", async () => {
    await renderTable();
    expect(await screen.findByText("Binh")).toBeInTheDocument();
    expect(lookupUsersMock).toHaveBeenCalledWith(["u-2"]);
  });

  it("says so when there are no records", async () => {
    listRecordsMock.mockResolvedValue({ items: [], next_cursor: null });
    getTableMock.mockResolvedValue(makeTable("editor"));
    render(
      <AuthProvider>
        <TableScreen tableId="t-1" />
      </AuthProvider>,
    );
    expect(await screen.findByText("No records match.")).toBeInTheDocument();
  });

  it("explains a refusal and lets the person try again", async () => {
    const user = userEvent.setup();
    getTableMock.mockRejectedValueOnce(new ApiError("Forbidden", 403));
    render(
      <AuthProvider>
        <TableScreen tableId="t-1" />
      </AuthProvider>,
    );
    expect(await screen.findByText(/do not have access to this table/)).toBeInTheDocument();
    getTableMock.mockResolvedValue(makeTable("viewer"));
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Tasks" })).toBeInTheDocument();
  });

  it("says when the table does not exist", async () => {
    getTableMock.mockRejectedValue(new ApiError("Not found", 404));
    render(
      <AuthProvider>
        <TableScreen tableId="t-1" />
      </AuthProvider>,
    );
    expect(await screen.findByText("This table does not exist.")).toBeInTheDocument();
  });

  it("still shows the table when the views cannot be loaded", async () => {
    listViewsMock.mockRejectedValue(new ApiError("Boom", 500));
    await renderTable();
    expect(screen.getByRole("button", { name: "All records" })).toBeInTheDocument();
  });
});

describe("who can change things", () => {
  it("lets editors add records and columns", async () => {
    await renderTable("editor");
    await userEvent.click(screen.getByRole("button", { name: "More ways to add" }));
    expect(screen.getByRole("menuitem", { name: "New record" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Table menu" }));
    expect(screen.getByRole("menuitem", { name: "Add a column" })).toBeInTheDocument();
  });

  it("offers Column access in the table menu to an admin of the table only", async () => {
    await renderTable("admin");
    await userEvent.click(screen.getByRole("button", { name: "Table menu" }));
    expect(screen.getByRole("menuitem", { name: "Column access" })).toBeInTheDocument();
    cleanup();

    await renderTable("editor");
    await userEvent.click(screen.getByRole("button", { name: "Table menu" }));
    expect(screen.getByRole("menuitem", { name: "Add a column" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Column access" })).not.toBeInTheDocument();
  });

  it("hides both from viewers", async () => {
    await renderTable("viewer");
    expect(screen.queryByRole("button", { name: "More ways to add" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New record" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add a column" })).not.toBeInTheDocument();
  });

  it("hides both from somebody who only sees their own tasks", async () => {
    await renderTable(null);
    expect(screen.queryByRole("button", { name: "More ways to add" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New record" })).not.toBeInTheDocument();
  });

  it("opens an empty record panel for a new record", async () => {
    const user = userEvent.setup();
    await renderTable("editor");
    await user.click(screen.getByRole("button", { name: "More ways to add" }));
    await user.click(screen.getByRole("menuitem", { name: "New record" }));
    expect(screen.getByRole("heading", { name: "New record" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create record" })).toBeInTheDocument();
  });

  it("opens the new record form when Add task is pressed somewhere else", async () => {
    getTableMock.mockResolvedValue(makeTable("editor"));
    listRecordsMock.mockResolvedValue({ items: [], next_cursor: null });
    const view = (signal: number) => (
      <AuthProvider>
        <TableScreen tableId="t-1" addTaskSignal={signal} />
      </AuthProvider>
    );
    const { rerender } = render(view(3)); // already handled when the screen starts
    await screen.findByRole("heading", { name: "Tasks" });
    expect(screen.queryByRole("heading", { name: "New record" })).not.toBeInTheDocument();

    rerender(view(4));
    expect(await screen.findByRole("heading", { name: "New record" })).toBeInTheDocument();
  });

  it("opens a record from the grid", async () => {
    const user = userEvent.setup();
    await renderTable("viewer");
    await user.click(screen.getByRole("button", { name: "Open record Alpha" }));
    const panel = screen.getByRole("dialog", { name: "Alpha" });
    expect(within(panel).getByLabelText("Name")).toHaveValue("Alpha");
    expect(within(panel).getByLabelText("Name")).toBeDisabled(); // a viewer cannot edit
  });
});

describe("editing and deleting from the row", () => {
  it("opens a record when its row is clicked", async () => {
    const user = userEvent.setup();
    await renderTable("editor");
    await user.click(within(rowOf("Beta")).getAllByRole("cell")[1]);
    expect(screen.getByRole("dialog", { name: "Beta" })).toBeInTheDocument();
  });

  it("shows only Delete as a row button to a viewer who created the records", async () => {
    await renderTable("viewer");
    expect(screen.queryByRole("button", { name: /^Edit record/ })).not.toBeInTheDocument();
    // A viewer who created the record can still delete it.
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(2);
  });

  it("opens the record, ready to edit, from the row", async () => {
    const user = userEvent.setup();
    await renderTable("editor");
    await user.click(within(rowOf("Alpha")).getAllByRole("cell")[1]);
    const panel = screen.getByRole("dialog", { name: "Alpha" });
    expect(within(panel).getByLabelText("Name")).toBeEnabled();
  });

  it("asks first, then deletes for good and drops the row at once", async () => {
    const user = userEvent.setup();
    deleteRecordMock.mockResolvedValue(undefined);
    await renderTable("editor");

    await user.click(within(rowOf("Alpha")).getByRole("button", { name: "Delete" }));
    expect(deleteRecordMock).not.toHaveBeenCalled();
    await user.click(within(rowOf("Alpha")).getByRole("button", { name: "Cancel" }));
    expect(deleteRecordMock).not.toHaveBeenCalled();

    await user.click(within(rowOf("Alpha")).getByRole("button", { name: "Delete" }));
    await user.click(within(rowOf("Alpha")).getByRole("button", { name: "Yes, delete" }));

    await waitFor(() => expect(deleteRecordMock).toHaveBeenCalledWith("r-1"));
    await waitFor(() => expect(screen.queryByText("Alpha")).not.toBeInTheDocument());
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("closes the record panel when that record is deleted", async () => {
    const user = userEvent.setup();
    deleteRecordMock.mockResolvedValue(undefined);
    await renderTable("editor");
    await user.click(within(rowOf("Alpha")).getAllByRole("cell")[1]);
    expect(screen.getByRole("dialog", { name: "Alpha" })).toBeInTheDocument();

    await user.click(within(rowOf("Alpha")).getByRole("button", { name: "Delete" }));
    await user.click(within(rowOf("Alpha")).getByRole("button", { name: "Yes, delete" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("offers Delete only on the records the person created", async () => {
    listRecordsMock.mockResolvedValue({
      items: [alpha, makeRecord("r-3", { "f-name": "Gamma" }, { created_by: "u-other" })],
      next_cursor: null,
    });
    await renderTable("editor");
    expect(within(rowOf("Alpha")).getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(within(rowOf("Gamma")).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(within(rowOf("Gamma")).getByRole("button", { name: /^Open record/ })).toBeInTheDocument();
  });

  it("shows the server's refusal and keeps the row", async () => {
    const user = userEvent.setup();
    deleteRecordMock.mockRejectedValue(
      new ApiError("Only the person who created a record can delete it.", 403),
    );
    await renderTable("editor");
    await user.click(within(rowOf("Alpha")).getByRole("button", { name: "Delete" }));
    await user.click(within(rowOf("Alpha")).getByRole("button", { name: "Yes, delete" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Only the person who created");
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });
});

describe("sorting", () => {
  it("cycles ascending, descending, none on a column", async () => {
    const user = userEvent.setup();
    await renderTable();
    const sortByPoints = () => screen.getByRole("button", { name: "Sort by Points" });

    await user.click(sortByPoints());
    await waitFor(() => expect(lastQuery()?.sort).toEqual([{ field: "f-points", direction: "asc" }]));
    expect(screen.getByRole("columnheader", { name: /Points/ })).toHaveAttribute("aria-sort", "ascending");

    await user.click(sortByPoints());
    await waitFor(() => expect(lastQuery()?.sort).toEqual([{ field: "f-points", direction: "desc" }]));
    expect(screen.getByRole("columnheader", { name: /Points/ })).toHaveAttribute("aria-sort", "descending");

    await user.click(sortByPoints());
    await waitFor(() => expect(lastQuery()?.sort).toEqual([]));
  });

  it("has no sort button on columns that have no order", async () => {
    await renderTable();
    expect(screen.queryByRole("button", { name: "Sort by Tags" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sort by Assignee" })).not.toBeInTheDocument();
  });
});

describe("sorting from the Sort menu", () => {
  it("sorts like the column heading does, and shows the column in use", async () => {
    const user = userEvent.setup();
    await renderTable();
    await user.click(screen.getByRole("button", { name: "Sort" }));
    await user.click(screen.getByRole("button", { name: "Points" }));
    await waitFor(() =>
      expect(lastQuery()?.sort).toEqual([{ field: "f-points", direction: "asc" }]),
    );
    expect(screen.getByRole("button", { name: /Sort\s*·\s*Points/ })).toBeInTheDocument();
  });
});

describe("filtering", () => {
  it("adds and removes a condition", async () => {
    const user = userEvent.setup();
    await renderTable();
    await user.click(screen.getByRole("button", { name: "Filter" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter column" }), "Points");
    await user.selectOptions(screen.getByRole("combobox", { name: "Operator" }), "gt");
    await user.type(screen.getByLabelText("Value"), "7");
    await user.click(screen.getByRole("button", { name: "Add filter" }));

    await waitFor(() =>
      expect(lastQuery()?.filter).toEqual([{ field: "f-points", op: "gt", value: 7 }]),
    );
    expect(screen.getByText("Points is after / greater than 7")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Remove filter Points/ }));
    await waitFor(() => expect(lastQuery()?.filter).toEqual([]));
  });

  it("filters a choice column by the option's id", async () => {
    const user = userEvent.setup();
    await renderTable();
    await user.click(screen.getByRole("button", { name: "Filter" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter column" }), "Priority");
    await user.selectOptions(screen.getByLabelText("Value"), "High");
    await user.click(screen.getByRole("button", { name: "Add filter" }));
    await waitFor(() =>
      expect(lastQuery()?.filter).toEqual([{ field: "f-priority", op: "eq", value: "o-high" }]),
    );
  });

  it("cannot add a filter that still needs a value", async () => {
    const user = userEvent.setup();
    await renderTable();
    await user.click(screen.getByRole("button", { name: "Filter" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter column" }), "Points");
    expect(screen.getByRole("button", { name: "Add filter" })).toBeDisabled();
  });

  it("offers 'is empty' without asking for a value", async () => {
    const user = userEvent.setup();
    await renderTable();
    await user.click(screen.getByRole("button", { name: "Filter" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter column" }), "Name");
    await user.selectOptions(screen.getByRole("combobox", { name: "Operator" }), "is_empty");
    expect(screen.queryByLabelText("Value")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add filter" }));
    await waitFor(() => expect(lastQuery()?.filter).toEqual([{ field: "f-name", op: "is_empty" }]));
  });

  it("offers a way out when the server refuses the filter", async () => {
    const user = userEvent.setup();
    await renderTable();
    listRecordsMock.mockRejectedValueOnce(new ApiError("One or more parameters are invalid.", 422));
    await user.click(screen.getByRole("button", { name: "Sort by Points" }));
    expect(await screen.findByText(/parameters are invalid/)).toBeInTheDocument();
    listRecordsMock.mockResolvedValue({ items: [alpha], next_cursor: null });
    await user.click(screen.getByRole("button", { name: "Clear filter and sort" }));
    await waitFor(() => expect(lastQuery()).toEqual({ filter: [], sort: [] }));
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
  });
});

describe("paging", () => {
  it("loads the next page with the cursor and appends it", async () => {
    const user = userEvent.setup();
    listRecordsMock.mockResolvedValueOnce({ items: [alpha], next_cursor: "c1" });
    getTableMock.mockResolvedValue(makeTable("editor"));
    render(
      <AuthProvider>
        <TableScreen tableId="t-1" />
      </AuthProvider>,
    );
    await screen.findByText("Alpha");
    listRecordsMock.mockResolvedValueOnce({ items: [beta], next_cursor: null });
    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(lastQuery()).toEqual({ filter: [], sort: [], cursor: "c1" });
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });
});

describe("columns", () => {
  it("hides a column on request", async () => {
    const user = userEvent.setup();
    await renderTable();
    await user.click(screen.getByRole("button", { name: "Show or hide columns" }));
    await user.click(screen.getByRole("checkbox", { name: "Points" }));
    expect(screen.queryByRole("columnheader", { name: /Points/ })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Name/ })).toBeInTheDocument();
  });
});

describe("views", () => {
  it("saves the filter, sort and hidden columns as a view", async () => {
    const user = userEvent.setup();
    const saved = makeView("v-1", "Big ones", {
      sort: [{ field: "f-points", direction: "desc" }],
      hidden_fields: ["f-tags"],
    });
    createViewMock.mockResolvedValue(saved);
    await renderTable();

    await user.click(screen.getByRole("button", { name: "Sort by Points" }));
    await user.click(screen.getByRole("button", { name: "Sort by Points" }));
    await user.click(screen.getByRole("button", { name: "Show or hide columns" }));
    await user.click(screen.getByRole("checkbox", { name: "Tags" }));
    await user.click(screen.getByRole("button", { name: "Save view" }));
    await user.type(screen.getByLabelText("View name"), "Big ones");
    await user.click(screen.getByRole("button", { name: "Save view" }));

    await waitFor(() => expect(createViewMock).toHaveBeenCalledTimes(1));
    expect(createViewMock).toHaveBeenCalledWith("t-1", "Big ones", {
      filter: [],
      sort: [{ field: "f-points", direction: "desc" }],
      hidden_fields: ["f-tags"],
    });
    expect(await screen.findByRole("button", { name: "Big ones" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("applies a saved view", async () => {
    const user = userEvent.setup();
    listViewsMock.mockResolvedValue([
      makeView("v-1", "By points", {
        filter: [{ field: "f-points", op: "gt", value: 1 }],
        sort: [{ field: "f-points", direction: "desc" }],
        hidden_fields: ["f-done"],
      }),
    ]);
    await renderTable();
    await user.click(await screen.findByRole("button", { name: "By points" }));
    await waitFor(() =>
      expect(lastQuery()).toEqual({
        filter: [{ field: "f-points", op: "gt", value: 1 }],
        sort: [{ field: "f-points", direction: "desc" }],
      }),
    );
    expect(screen.queryByRole("columnheader", { name: /Done/ })).not.toBeInTheDocument();
  });

  it("drops the parts of a view that name a column which no longer exists", async () => {
    const user = userEvent.setup();
    listViewsMock.mockResolvedValue([
      makeView("v-1", "Old", {
        filter: [{ field: "f-gone", op: "eq", value: 1 }],
        sort: [{ field: "f-gone", direction: "asc" }],
        hidden_fields: ["f-gone"],
      }),
    ]);
    await renderTable();
    await user.click(await screen.findByRole("button", { name: "Old" }));
    await waitFor(() => expect(lastQuery()).toEqual({ filter: [], sort: [] }));
  });

  it("deletes the view in use", async () => {
    const user = userEvent.setup();
    listViewsMock.mockResolvedValue([makeView("v-1", "Mine")]);
    deleteViewMock.mockResolvedValue(undefined);
    await renderTable();
    await user.click(await screen.findByRole("button", { name: "Mine" }));
    await user.click(screen.getByRole("button", { name: "Delete this view" }));
    await waitFor(() => expect(deleteViewMock).toHaveBeenCalledWith("v-1"));
    expect(screen.queryByRole("button", { name: "Mine" })).not.toBeInTheDocument();
  });

  it("shows why a view could not be saved", async () => {
    const user = userEvent.setup();
    createViewMock.mockRejectedValue(new ApiError("You already have a view with this name.", 409));
    await renderTable();
    await user.click(screen.getByRole("button", { name: "Save view" }));
    await user.type(screen.getByLabelText("View name"), "Mine");
    await user.click(screen.getByRole("button", { name: "Save view" }));
    expect(await screen.findByText("You already have a view with this name.")).toBeInTheDocument();
  });

  it("changes back to 'All records' as soon as the person changes the table", async () => {
    const user = userEvent.setup();
    listViewsMock.mockResolvedValue([makeView("v-1", "Mine")]);
    await renderTable();
    await user.click(await screen.findByRole("button", { name: "Mine" }));
    await user.click(screen.getByRole("button", { name: "Sort by Points" }));
    expect(screen.getByRole("button", { name: "All records" })).toHaveAttribute("aria-pressed", "true");
  });
});

it("does not break when every column is hidden", async () => {
  const user = userEvent.setup();
  await renderTable();
  await user.click(screen.getByRole("button", { name: "Show or hide columns" }));
  for (const field of FIELDS) {
    await user.click(screen.getByRole("checkbox", { name: field.name }));
  }
  // The first column stays: records are opened from it.
  // (An editor also has the unnamed column of row buttons.)
  const headers = screen.getAllByRole("columnheader").filter((h) => h.textContent !== "Actions");
  expect(headers).toHaveLength(1);
});

describe("hidden columns survive a reload", () => {
  it("remembers the hidden columns of a table in the browser", async () => {
    const user = userEvent.setup();
    await renderTable();
    await user.click(screen.getByRole("button", { name: "Show or hide columns" }));
    await user.click(screen.getByRole("checkbox", { name: "Points" }));
    expect(screen.queryByRole("columnheader", { name: /Points/ })).not.toBeInTheDocument();
    cleanup();

    await renderTable();
    expect(await screen.findByRole("columnheader", { name: /Name/ })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /Points/ })).not.toBeInTheDocument();
  });
});

describe("a filter that comes from the reports", () => {
  const STATUS = makeField("f-status", "Status", "status", {
    semantic: "status",
    config: {
      options: [
        { id: "o-todo", name: "To do", kind: "todo" },
        { id: "o-done", name: "Done", kind: "done" },
      ],
    },
  });
  const DUE_DATE = makeField("f-due", "Due date", "date", {
    semantic: "due_date",
    config: { include_time: false },
  });

  async function renderWith(fields: FieldItem[], preset: ComponentProps<typeof TableScreen>["preset"]) {
    getTableMock.mockResolvedValue(makeTable("editor", fields));
    render(
      <AuthProvider>
        <TableScreen tableId="t-1" preset={preset} />
      </AuthProvider>,
    );
    await screen.findByRole("heading", { name: "Tasks" });
  }

  it("is applied once the columns are known", async () => {
    await renderWith([NAME, ASSIGNEE, STATUS, DUE_DATE], {
      show: "overdue",
      person: "u-2",
      today: "2026-11-17",
    });
    await waitFor(() =>
      expect(lastQuery()).toEqual({
        filter: [
          { field: "f-status", op: "neq", value: "o-done" },
          { field: "f-due", op: "lt", value: "2026-11-17" },
          { field: "f-assignee", op: "contains", value: "u-2" },
        ],
        sort: [],
      }),
    );
    // The records were never asked for without the filter, so nothing flashes on the screen.
    expect(listRecordsMock.mock.calls.every(([, query]) => query?.filter.length === 3)).toBe(true);
  });

  it("can be cleared like any other filter", async () => {
    const user = userEvent.setup();
    await renderWith([NAME, ASSIGNEE, STATUS, DUE_DATE], {
      show: "open",
      today: "2026-11-17",
    });
    await waitFor(() => expect(lastQuery()?.filter).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: /Remove filter/ }));
    await waitFor(() => expect(lastQuery()?.filter).toEqual([]));
  });

  it("is explained when the table has no column for it", async () => {
    await renderWith([NAME], { show: "overdue", today: "2026-11-17" });
    expect(await screen.findByText(/no column for that report/)).toBeInTheDocument();
    expect(lastQuery()).toEqual({ filter: [], sort: [] });
  });

  it("does nothing without a preset", async () => {
    await renderWith([NAME, STATUS], undefined);
    await waitFor(() => expect(lastQuery()).toEqual({ filter: [], sort: [] }));
  });
});

describe("hiding the columns that are empty", () => {
  it("leaves out the columns with no value in any row, and remembers the choice", async () => {
    const user = userEvent.setup();
    const view = await renderTable();
    expect(screen.getByRole("columnheader", { name: /Tags/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show or hide columns" }));
    await user.click(screen.getByRole("checkbox", { name: /Hide empty columns/ }));
    expect(screen.queryByRole("columnheader", { name: /Tags/ })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Points/ })).toBeInTheDocument();
    expect(window.localStorage.getItem("table-hide-empty:t-1")).toBe("1");

    // Opened again later in the same browser: still hidden.
    view.unmount();
    await renderTable();
    expect(screen.queryByRole("columnheader", { name: /Tags/ })).not.toBeInTheDocument();
  });
});

describe("the counts above the table", () => {
  it("shows none for a table without a status column", async () => {
    await renderTable();
    expect(screen.queryByRole("list", { name: "Task counts" })).not.toBeInTheDocument();
  });
});
