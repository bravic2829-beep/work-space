import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchMe } from "@/features/auth/api";
import { AuthProvider } from "@/features/auth/AuthProvider";
import { sampleUser } from "@/test/fixtures";

import {
  createView,
  getGroups,
  getRecordViewers,
  getTable,
  listRecords,
  listViews,
  lookupUsers,
} from "./api";
import { ASSIGNEE, FIELDS, NAME, makeField, makeRecord, makeTable, makeView } from "./fixtures";
import { formatTotal, groupableFields, groupKey, numberFields, totalTexts } from "./groups";
import { GroupMenu } from "./GroupMenu";
import { RecordGrid, type GridSection } from "./RecordGrid";
import type { Group, GroupBucket, GroupsResult, TotalFn, ViewTotal } from "./schema";
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
  getGroups: vi.fn(),
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

const getTableMock = vi.mocked(getTable);
const listViewsMock = vi.mocked(listViews);
const listRecordsMock = vi.mocked(listRecords);
const getGroupsMock = vi.mocked(getGroups);
const createViewMock = vi.mocked(createView);

const high = makeRecord("r-1", { "f-name": "Alpha", "f-points": 10, "f-priority": "o-high" });
const high2 = makeRecord("r-2", { "f-name": "Beta", "f-points": 5, "f-priority": "o-high" });
const plain = makeRecord("r-3", { "f-name": "Gamma", "f-points": 2 });

const HIGH: Group = {
  key: "o-high",
  label: "High",
  count: 2,
  totals: [{ field_id: "f-points", fn: "sum", value: 15 }],
  filter: [{ field: "f-priority", op: "eq", value: "o-high" }],
};
const NONE: Group = {
  key: null,
  label: "(empty)",
  count: 1,
  totals: [{ field_id: "f-points", fn: "sum", value: null }],
  filter: [{ field: "f-priority", op: "is_empty" }],
};
const BY_PRIORITY: GroupsResult = {
  group_by: "f-priority",
  bucket: null,
  total: 3,
  truncated: false,
  groups: [HIGH, NONE],
};

/** The rows the record list answers for a group's own filter. */
function answerByGroup() {
  listRecordsMock.mockImplementation(async (_table, query) => {
    const on = (op: string) => query.filter.some((c) => c.field === "f-priority" && c.op === op);
    if (on("eq")) return { items: [high, high2], next_cursor: null };
    if (on("is_empty")) return { items: [plain], next_cursor: null };
    return { items: [high, high2, plain], next_cursor: null };
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  resetUserNames();
  vi.mocked(fetchMe).mockResolvedValue(sampleUser({ id: "u-me" }));
  getTableMock.mockResolvedValue(makeTable("editor"));
  listViewsMock.mockResolvedValue([]);
  answerByGroup();
  getGroupsMock.mockResolvedValue(BY_PRIORITY);
  vi.mocked(lookupUsers).mockResolvedValue([]);
  vi.mocked(getRecordViewers).mockResolvedValue({
    people: [],
    workspace_name: "Workspace",
    workspace_member_count: 1,
  });
});

// --- the helpers -------------------------------------------------------------------------------

describe("group helpers", () => {
  it("lists the columns that can be grouped and the ones that can be totalled", () => {
    expect(groupableFields(FIELDS).map((f) => f.name)).toEqual([
      "Name",
      "Points",
      "Done",
      "Priority",
      "Tags",
      "Due date",
      "Assignee",
      "Created time",
    ]);
    expect(numberFields(FIELDS).map((f) => f.name)).toEqual(["Points"]);
  });

  it("writes a total with the precision of its column, two decimals for an average", () => {
    const points = FIELDS.find((f) => f.id === "f-points");
    expect(formatTotal(1234, points, "sum")).toBe("1,234");
    expect(formatTotal(2.5, points, "avg")).toBe("2.5");
    expect(formatTotal(2.3333, points, "avg")).toBe("2.33");
    const score = { ...points!, config: { precision: 1 } };
    expect(formatTotal(0.85, score, "sum")).toBe("0.9");
  });

  it("says what a group header shows under each column, and nothing for an empty total", () => {
    const texts = totalTexts(
      {
        ...HIGH,
        totals: [
          { field_id: "f-points", fn: "sum", value: 15 },
          { field_id: "f-points", fn: "avg", value: 7.5 },
        ],
      },
      FIELDS,
    );
    expect(texts.get("f-points")).toEqual(["Sum 15", "Average 7.5"]);
    expect(totalTexts(NONE, FIELDS).size).toBe(0);
    expect(groupKey(NONE)).not.toBe(groupKey(HIGH));
  });
});

// --- the menu ----------------------------------------------------------------------------------

describe("GroupMenu", () => {
  function Harness({ start = null }: { start?: string | null }) {
    const [groupBy, setGroupBy] = useState<string | null>(start);
    const [bucket, setBucket] = useState<GroupBucket | null>(null);
    const [totals, setTotals] = useState<ViewTotal[]>([]);
    return (
      <>
        <GroupMenu
          fields={FIELDS}
          groupBy={groupBy}
          bucket={bucket}
          totals={totals}
          onGroupBy={setGroupBy}
          onBucket={setBucket}
          onTotal={(field: string, fn: TotalFn | null) =>
            setTotals((current) => [
              ...current.filter((t) => t.field !== field),
              ...(fn ? [{ field, fn }] : []),
            ])
          }
        />
        <output aria-label="state">{JSON.stringify({ groupBy, bucket, totals })}</output>
      </>
    );
  }
  const state = () => JSON.parse(screen.getByLabelText("state").textContent ?? "{}");

  it("chooses the column to group by, and shows it on the button", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Group" }));
    await user.selectOptions(screen.getByLabelText("Group by"), "f-priority");
    expect(state().groupBy).toBe("f-priority");
    expect(screen.getByRole("button", { name: /Group.*Priority/ })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Group by"), "");
    expect(state().groupBy).toBeNull();
  });

  it("offers days, weeks or months only for a date column", async () => {
    const user = userEvent.setup();
    render(<Harness start="f-priority" />);
    await user.click(screen.getByRole("button", { name: /Group/ }));
    expect(screen.queryByLabelText("Group dates by")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Group by"), "f-due");
    expect(screen.getByLabelText("Group dates by")).toHaveValue("month");
    await user.selectOptions(screen.getByLabelText("Group dates by"), "week");
    expect(state().bucket).toBe("week");
  });

  it("chooses a total for each number column, and removes it", async () => {
    const user = userEvent.setup();
    render(<Harness start="f-priority" />);
    await user.click(screen.getByRole("button", { name: /Group/ }));
    expect(screen.getAllByLabelText(/^Total of /)).toHaveLength(1); // Points is the only number
    await user.selectOptions(screen.getByLabelText("Total of Points"), "sum");
    expect(state().totals).toEqual([{ field: "f-points", fn: "sum" }]);
    await user.selectOptions(screen.getByLabelText("Total of Points"), "avg");
    expect(state().totals).toEqual([{ field: "f-points", fn: "avg" }]);
    await user.selectOptions(screen.getByLabelText("Total of Points"), "");
    expect(state().totals).toEqual([]);
  });

  it("asks for no totals before there is a grouping", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Group" }));
    expect(screen.queryByText("Totals on each group")).not.toBeInTheDocument();
  });
});

// --- the grid with groups ------------------------------------------------------------------------

describe("RecordGrid with groups", () => {
  const fields = FIELDS.slice(0, 4); // Name, Points, Done, Priority

  function section(group: Group, over: Partial<GridSection> = {}): GridSection {
    return {
      key: groupKey(group),
      group,
      records: [],
      open: false,
      loading: false,
      hasMore: false,
      error: null,
      ...over,
    };
  }

  function grid(sections: GridSection[], handlers = {}) {
    return render(
      <RecordGrid
        fields={fields}
        records={[]}
        sections={sections}
        names={new Map()}
        sort={[]}
        selectedId={null}
        hasMore={false}
        loadingMore={false}
        onSort={() => undefined}
        onSelect={() => undefined}
        onLoadMore={() => undefined}
        {...handlers}
      />,
    );
  }

  it("shows each group's name, its size and its totals under the column", () => {
    grid([section(HIGH), section(NONE)]);
    const header = screen.getByRole("button", { name: /High/ }).closest("tr") as HTMLElement;
    expect(within(header).getByText("2 records")).toBeInTheDocument();
    expect(within(header).getByText("Sum 15")).toBeInTheDocument();
    const empty = screen.getByRole("button", { name: /\(empty\)/ }).closest("tr") as HTMLElement;
    expect(within(empty).getByText("1 record")).toBeInTheDocument();
    expect(within(empty).queryByText(/Sum/)).not.toBeInTheDocument(); // no value, no total
  });

  it("draws the rows of an open group and none of a closed one", () => {
    grid([section(HIGH, { open: true, records: [high, high2] }), section(NONE, { records: [plain] })]);
    expect(screen.getByRole("button", { name: "Open record Alpha" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open record Beta" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open record Gamma" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /High/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /\(empty\)/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("opens and closes a group from its header", async () => {
    const onToggle = vi.fn();
    grid([section(HIGH)], { onToggleSection: onToggle });
    await userEvent.setup().click(screen.getByRole("button", { name: /High/ }));
    expect(onToggle).toHaveBeenCalledWith("o-high");
  });

  it("says when a group is loading, failed, empty or has more", async () => {
    const onMore = vi.fn();
    const { rerender } = grid([section(HIGH, { open: true, loading: true })]);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    const again = (s: GridSection) =>
      rerender(
        <RecordGrid
          fields={fields}
          records={[]}
          sections={[s]}
          names={new Map()}
          sort={[]}
          selectedId={null}
          hasMore={false}
          loadingMore={false}
          onSort={() => undefined}
          onSelect={() => undefined}
          onLoadMore={() => undefined}
          onLoadMoreSection={onMore}
        />,
      );
    again(section(HIGH, { open: true, error: "Could not load these records." }));
    expect(screen.getByText("Could not load these records.")).toBeInTheDocument();
    again(section(HIGH, { open: true }));
    expect(screen.getByText("No records in this group.")).toBeInTheDocument();
    again(section(HIGH, { open: true, records: [high], hasMore: true }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Load more in this group" }));
    expect(onMore).toHaveBeenCalledWith("o-high");
  });

  it("does not open a group whose value no longer exists", () => {
    grid([section({ ...HIGH, label: "(removed option)", filter: null })]);
    const button = screen.getByRole("button", { name: /removed option/ });
    expect(button).toBeDisabled();
    expect(button).not.toHaveAttribute("aria-expanded");
  });

  it("explains an empty result", () => {
    grid([]);
    expect(screen.getByText("No records match.")).toBeInTheDocument();
  });
});

// --- the table screen --------------------------------------------------------------------------------

async function renderTable() {
  render(
    <AuthProvider>
      <TableScreen tableId="t-1" />
    </AuthProvider>,
  );
  await screen.findByRole("heading", { name: "Tasks" });
  await screen.findByText("Alpha");
}

async function groupByPriority(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Group" }));
  await user.selectOptions(screen.getByLabelText("Group by"), "f-priority");
}

describe("grouping a table", () => {
  it("folds the rows into groups, with the rows of the open ones", async () => {
    const user = userEvent.setup();
    await renderTable();
    await groupByPriority(user);

    expect(await screen.findByRole("button", { name: /High/ })).toBeInTheDocument();
    expect(getGroupsMock).toHaveBeenLastCalledWith(
      "t-1",
      { groupBy: "f-priority", bucket: null, totals: [], filter: [] },
      expect.anything(),
    );
    // Each open group is read with its own filter.
    await waitFor(() =>
      expect(listRecordsMock).toHaveBeenCalledWith(
        "t-1",
        { filter: HIGH.filter, sort: [] },
        expect.anything(),
      ),
    );
    expect(await screen.findByRole("button", { name: "Open record Beta" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open record Gamma" })).toBeInTheDocument();
  });

  it("puts the filter of the table in front of the filter of a group", async () => {
    const user = userEvent.setup();
    await renderTable();
    await user.click(screen.getByRole("button", { name: /Add filter|Filter/ }));
    // The table filter is shared with the groups: choose Points > 1.
    await user.selectOptions(screen.getByLabelText("Filter column"), "f-points");
    await user.selectOptions(screen.getByLabelText("Operator"), "gt");
    await user.type(screen.getByLabelText("Value"), "1");
    await user.click(screen.getByRole("button", { name: /^Add$|Apply|Add filter/ }));
    await groupByPriority(user);
    const filter = [{ field: "f-points", op: "gt", value: 1 }];
    await waitFor(() =>
      expect(getGroupsMock).toHaveBeenLastCalledWith(
        "t-1",
        expect.objectContaining({ filter }),
        expect.anything(),
      ),
    );
    await waitFor(() =>
      expect(listRecordsMock).toHaveBeenCalledWith(
        "t-1",
        { filter: [...filter, ...(HIGH.filter ?? [])], sort: [] },
        expect.anything(),
      ),
    );
  });

  it("reads the groups again with the totals that were chosen, and shows them", async () => {
    const user = userEvent.setup();
    await renderTable();
    await groupByPriority(user);
    await screen.findByRole("button", { name: /High/ });
    await user.selectOptions(screen.getByLabelText("Total of Points"), "sum");
    await waitFor(() =>
      expect(getGroupsMock).toHaveBeenLastCalledWith(
        "t-1",
        { groupBy: "f-priority", bucket: null, totals: [{ field: "f-points", fn: "sum" }], filter: [] },
        expect.anything(),
      ),
    );
    expect(await screen.findByText("Sum 15")).toBeInTheDocument();
  });

  it("opens a closed group when its header is pressed", async () => {
    const user = userEvent.setup();
    getGroupsMock.mockResolvedValue({
      ...BY_PRIORITY,
      groups: Array.from({ length: 7 }, (_, i) => ({
        ...HIGH,
        key: `o-${i}`,
        label: `Group ${i}`,
        filter: [{ field: "f-priority", op: "eq", value: `o-${i}` }],
      })),
    });
    listRecordsMock.mockImplementation(async (_t, query) => {
      const value = query.filter.find((c) => c.field === "f-priority")?.value;
      return {
        items: value ? [makeRecord(`row-${value}`, { "f-name": `Row of ${value}` })] : [high],
        next_cursor: null,
      };
    });
    await renderTable();
    await groupByPriority(user);
    // The first five are open, the others wait to be opened.
    expect(await screen.findByText("Row of o-0")).toBeInTheDocument();
    expect(screen.getByText("Row of o-4")).toBeInTheDocument();
    expect(screen.queryByText("Row of o-5")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Group 5/ }));
    expect(await screen.findByText("Row of o-5")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Group 5/ }));
    expect(screen.queryByText("Row of o-5")).not.toBeInTheDocument();
  });

  it("opens a task of a group in the panel", async () => {
    const user = userEvent.setup();
    await renderTable();
    await groupByPriority(user);
    await user.click(await screen.findByRole("button", { name: "Open record Beta" }));
    expect(await screen.findByRole("heading", { name: "Beta" })).toBeInTheDocument();
  });

  it("goes back to the plain list when the grouping is removed", async () => {
    const user = userEvent.setup();
    await renderTable();
    await groupByPriority(user);
    await screen.findByRole("button", { name: /High/ });
    await user.selectOptions(screen.getByLabelText("Group by"), "");
    await waitFor(() => expect(screen.queryByRole("button", { name: /High/ })).not.toBeInTheDocument());
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    expect(listRecordsMock).toHaveBeenLastCalledWith(
      "t-1",
      { filter: [], sort: [] },
      expect.anything(),
    );
  });

  it("shows why the groups could not be read, and lets the person ungroup", async () => {
    const user = userEvent.setup();
    getGroupsMock.mockRejectedValue(new Error("boom"));
    await renderTable();
    await groupByPriority(user);
    expect(await screen.findByText("Something went wrong.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove the grouping" }));
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
  });

  it("says when there are more groups than are shown", async () => {
    const user = userEvent.setup();
    getGroupsMock.mockResolvedValue({ ...BY_PRIORITY, truncated: true });
    await renderTable();
    await groupByPriority(user);
    expect(await screen.findByText(/Only the first groups are shown/)).toBeInTheDocument();
  });

  it("is not offered on a person's sheet", async () => {
    render(
      <AuthProvider>
        <TableScreen
          tableId="t-1"
          sheet={{
            id: "s-1",
            table_id: "t-1",
            name: "An",
            owner: { id: "u-2", full_name: "An", employee_code: "E2" },
            my_role: "editor",
            members: [],
          } as never}
        />
      </AuthProvider>,
    );
    await screen.findByRole("heading", { name: "Tasks" });
    expect(screen.queryByRole("button", { name: "Group" })).not.toBeInTheDocument();
  });
});

// --- saved views ----------------------------------------------------------------------------------

describe("views that keep a grouping", () => {
  it("saves the grouping, the date bucket and the totals with the view", async () => {
    const user = userEvent.setup();
    createViewMock.mockImplementation(async (_t, name, config) => makeView("v-new", name, config));
    await renderTable();
    await user.click(screen.getByRole("button", { name: "Group" }));
    await user.selectOptions(screen.getByLabelText("Group by"), "f-due");
    await user.selectOptions(screen.getByLabelText("Group dates by"), "week");
    await user.selectOptions(screen.getByLabelText("Total of Points"), "avg");
    await user.click(screen.getByRole("button", { name: "Save view" }));
    await user.type(screen.getByLabelText("View name"), "By week");
    await user.click(screen.getAllByRole("button", { name: "Save view" }).at(-1)!);
    await waitFor(() => expect(createViewMock).toHaveBeenCalled());
    expect(createViewMock).toHaveBeenCalledWith("t-1", "By week", {
      filter: [],
      sort: [],
      hidden_fields: [],
      group_by: "f-due",
      group_bucket: "week",
      totals: [{ field: "f-points", fn: "avg" }],
    });
  });

  it("saves a view that does not group exactly as before", async () => {
    const user = userEvent.setup();
    createViewMock.mockImplementation(async (_t, name, config) => makeView("v-new", name, config));
    await renderTable();
    await user.click(screen.getByRole("button", { name: "Save view" }));
    await user.type(screen.getByLabelText("View name"), "Plain");
    await user.click(screen.getAllByRole("button", { name: "Save view" }).at(-1)!);
    await waitFor(() => expect(createViewMock).toHaveBeenCalled());
    expect(createViewMock).toHaveBeenCalledWith("t-1", "Plain", {
      filter: [],
      sort: [],
      hidden_fields: [],
    });
  });

  it("groups again when a saved view with a grouping is chosen", async () => {
    const user = userEvent.setup();
    listViewsMock.mockResolvedValue([
      makeView("v-1", "By priority", {
        group_by: "f-priority",
        totals: [{ field: "f-points", fn: "sum" }],
      }),
    ]);
    await renderTable();
    await user.click(await screen.findByRole("button", { name: "By priority" }));
    expect(await screen.findByRole("button", { name: /High/ })).toBeInTheDocument();
    expect(getGroupsMock).toHaveBeenLastCalledWith(
      "t-1",
      {
        groupBy: "f-priority",
        bucket: null,
        totals: [{ field: "f-points", fn: "sum" }],
        filter: [],
      },
      expect.anything(),
    );
    // Back to "All records": no grouping.
    await user.click(screen.getByRole("button", { name: "All records" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /High/ })).not.toBeInTheDocument());
  });

  it("ignores a view's column that no longer exists", async () => {
    const user = userEvent.setup();
    listViewsMock.mockResolvedValue([makeView("v-1", "Old", { group_by: "f-gone" })]);
    await renderTable();
    await user.click(await screen.findByRole("button", { name: "Old" }));
    expect(getGroupsMock).not.toHaveBeenCalled();
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
  });
});

describe("a tab of the reports page", () => {
  const STATUS = makeField("f-status", "Status", "status", {
    semantic: "status",
    config: {
      options: [
        { id: "o-todo", name: "To do", kind: "todo" },
        { id: "o-blocked", name: "Blocked", kind: "blocked" },
        { id: "o-paused", name: "Paused", kind: "paused" },
      ],
    },
  });
  const SCORE = makeField("f-score", "Review score", "number", {
    semantic: "review_score",
    config: { precision: 1 },
  });
  const COLUMNS = [NAME, ASSIGNEE, STATUS, SCORE].map((f, position) => ({ ...f, position }));

  async function open(reportView: "summary" | "risk" | "review") {
    getTableMock.mockResolvedValue(makeTable("editor", COLUMNS));
    getGroupsMock.mockResolvedValue({
      group_by: "x",
      bucket: null,
      total: 0,
      truncated: false,
      groups: [],
    });
    render(
      <AuthProvider>
        <TableScreen tableId="t-1" reportView={reportView} />
      </AuthProvider>,
    );
    await screen.findByRole("heading", { name: "Tasks" });
  }

  it("groups the at-risk tasks under their assignee, filtered to blocked and paused", async () => {
    await open("risk");
    await waitFor(() =>
      expect(getGroupsMock).toHaveBeenCalledWith(
        "t-1",
        {
          groupBy: "f-assignee",
          bucket: null,
          totals: [],
          filter: [{ field: "f-status", op: "in", value: ["o-blocked", "o-paused"] }],
        },
        expect.anything(),
      ),
    );
    // The records are only read group by group: never the whole table first.
    expect(listRecordsMock).not.toHaveBeenCalled();
  });

  it("averages the review score on each group", async () => {
    await open("review");
    await waitFor(() =>
      expect(getGroupsMock).toHaveBeenCalledWith(
        "t-1",
        expect.objectContaining({
          groupBy: "f-status", // this table has no parent column
          totals: [{ field: "f-score", fn: "avg" }],
        }),
        expect.anything(),
      ),
    );
  });

  it("can be ungrouped like any other grouping", async () => {
    const user = userEvent.setup();
    await open("summary");
    await waitFor(() => expect(getGroupsMock).toHaveBeenCalled());
    listRecordsMock.mockResolvedValue({ items: [plain], next_cursor: null });
    await user.click(screen.getByRole("button", { name: /Group/ }));
    await user.selectOptions(screen.getByLabelText("Group by"), "");
    expect(await screen.findByText("Gamma")).toBeInTheDocument();
  });
});
