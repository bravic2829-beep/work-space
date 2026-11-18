import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchMe } from "@/features/auth/api";
import { AuthProvider } from "@/features/auth/AuthProvider";
import { ApiError } from "@/lib/api/client";
import { adminUser, sampleUser } from "@/test/fixtures";

import {
  checkIn,
  createCycle,
  createKeyResult,
  createObjective,
  deleteCycle,
  deleteObjective,
  getOverview,
  listCheckIns,
  listCycles,
  listOkrDepartments,
  reviewKeyResult,
  reviewObjective,
  updateCycle,
  updateKeyResult,
  updateObjective,
} from "./api";
import { AlignmentTree, buildTree } from "./AlignmentTree";
import { OkrScreen } from "./OkrScreen";
import { OkrTable } from "./OkrTable";
import {
  averageScore,
  formatValue,
  isObjective,
  isOverview,
  percent,
  scoreText,
  type Cycle,
  type KeyResult,
  type Objective,
  type Overview,
} from "./schema";

vi.mock("@/features/auth/api", () => ({ fetchMe: vi.fn(), login: vi.fn(), logout: vi.fn() }));
vi.mock("@/features/tables/api", () => ({
  searchDirectory: vi.fn().mockResolvedValue([]),
  lookupUsers: vi.fn().mockResolvedValue([]),
}));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  listCycles: vi.fn(),
  createCycle: vi.fn(),
  updateCycle: vi.fn(),
  deleteCycle: vi.fn(),
  getOverview: vi.fn(),
  listOkrDepartments: vi.fn(),
  createObjective: vi.fn(),
  updateObjective: vi.fn(),
  deleteObjective: vi.fn(),
  createKeyResult: vi.fn(),
  updateKeyResult: vi.fn(),
  deleteKeyResult: vi.fn(),
  checkIn: vi.fn(),
  listCheckIns: vi.fn(),
  reviewObjective: vi.fn(),
  reviewKeyResult: vi.fn(),
}));

/** The button that folds an objective: its title and the number of its key results. */
const HEADER = /^Make the shop our main channel \d+ key results?$/;

const AN = { id: "u-an", full_name: "Nguyen Van An", employee_code: "NV101" };
const BINH = { id: "u-binh", full_name: "Tran Thi Binh", employee_code: "NV102" };

const CYCLE: Cycle = {
  id: "c-1",
  name: "2026 Q4",
  starts_on: "2026-10-01",
  ends_on: "2026-12-31",
  status: "open",
  created_at: "2026-09-01T00:00:00Z",
};

function kr(over: Partial<KeyResult> = {}): KeyResult {
  return {
    id: "kr-1",
    objective_id: "o-1",
    title: "Online orders per month",
    owner: AN,
    unit: "orders",
    start_value: 0,
    target_value: 100,
    current_value: 40,
    progress: 0.4,
    status: "on_track",
    score: null,
    merits: null,
    to_improve: null,
    position: 0,
    updated_at: "2026-11-10T00:00:00Z",
    last_check_in_at: null,
    can_check_in: true,
    ...over,
  };
}

function objective(over: Partial<Objective> = {}): Objective {
  return {
    id: "o-1",
    cycle_id: "c-1",
    title: "Make the shop our main channel",
    description: null,
    owner: AN,
    level: "personal",
    department: null,
    parent_id: null,
    is_private: false,
    progress: 0.4,
    score: null,
    merits: null,
    to_improve: null,
    position: 0,
    can_edit: true,
    can_review: false,
    key_results: [kr()],
    ...over,
  };
}

function overview(objectives: Objective[], over: Partial<Overview["summary"]> = {}): Overview {
  const krs = objectives.flatMap((o) => o.key_results);
  return {
    cycle: CYCLE,
    objectives,
    summary: {
      objectives: objectives.length,
      key_results: krs.length,
      progress: objectives.length > 0 ? 0.4 : null,
      on_track: krs.filter((k) => k.status === "on_track").length,
      at_risk: krs.filter((k) => k.status === "at_risk").length,
      off_track: krs.filter((k) => k.status === "off_track").length,
      reviewed: 0,
      ...over,
    },
  };
}

// --- the numbers and the shapes -----------------------------------------------------------------------

describe("how OKR numbers are written", () => {
  it("writes a progress, a value with its unit and a score", () => {
    expect(percent(0.756)).toBe("76%");
    expect(percent(0)).toBe("0%");
    expect(percent(1)).toBe("100%");
    expect(percent(null)).toBe("—");
    expect(formatValue(1200, "$")).toBe("1,200 $");
    expect(formatValue(2.5, "")).toBe("2.5");
    expect(scoreText(0.84)).toBe("0.8");
    expect(scoreText(null)).toBe("—");
  });

  it("averages the scores that exist", () => {
    const o = objective({
      key_results: [kr({ score: 0.8 }), kr({ id: "kr-2", score: 0.4 }), kr({ id: "kr-3" })],
    });
    expect(averageScore(o)).toBeCloseTo(0.6);
    expect(averageScore(objective({ key_results: [kr()] }))).toBeNull();
  });

  it("checks the shape of what the server sends", () => {
    expect(isObjective(objective())).toBe(true);
    expect(isObjective({ ...objective(), level: "galaxy" })).toBe(false);
    expect(isObjective({ ...objective(), key_results: [{ id: "x" }] })).toBe(false);
    expect(isOverview(overview([objective()]))).toBe(true);
    expect(isOverview({ ...overview([]), summary: { objectives: 1 } })).toBe(false);
  });
});

// --- the grid --------------------------------------------------------------------------------------------

describe("OkrTable", () => {
  const handlers = {
    onOpenKr: vi.fn(),
    onAddKr: vi.fn(),
    onEditObjective: vi.fn(),
    onReviewObjective: vi.fn(),
    onReviewKr: vi.fn(),
  };
  beforeEach(() => vi.clearAllMocks());

  function table(objectives: Objective[], mode: "summary" | "review" = "summary", cycleOpen = true) {
    return render(
      <OkrTable
        objectives={objectives}
        mode={mode}
        cycleOpen={cycleOpen}
        emptyText="Nothing here."
        {...handlers}
      />,
    );
  }

  it("groups the key results under their objective with its progress", () => {
    table([
      objective({
        progress: 0.5,
        key_results: [kr(), kr({ id: "kr-2", title: "Cut the returns", progress: 1, current_value: 2 })],
      }),
    ]);
    const header = screen.getByRole("button", { name: HEADER }).closest("tr") as HTMLElement;
    expect(within(header).getByText("2 key results")).toBeInTheDocument();
    expect(within(header).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByRole("button", { name: "Open key result Online orders per month" })).toBeInTheDocument();
    expect(screen.getByText("40 orders")).toBeInTheDocument();
    expect(screen.getAllByText("On track").length).toBeGreaterThan(0);
  });

  it("shows the level or the department, and a lock on a private objective", () => {
    table([
      objective({ id: "o-a", title: "A", level: "company" }),
      objective({ id: "o-b", title: "B", level: "department", department: { id: "d", name: "Sales" } }),
      objective({ id: "o-c", title: "C", is_private: true }),
    ]);
    expect(screen.getByText("Company")).toBeInTheDocument();
    expect(screen.getByText("Sales")).toBeInTheDocument();
    expect(screen.getByLabelText("Private objective")).toBeInTheDocument();
  });

  it("folds and unfolds an objective", async () => {
    const user = userEvent.setup();
    table([objective()]);
    const toggle = screen.getByRole("button", { name: HEADER });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.click(toggle);
    expect(screen.queryByRole("button", { name: /Open key result/ })).not.toBeInTheDocument();
    await user.click(toggle);
    expect(screen.getByRole("button", { name: /Open key result/ })).toBeInTheDocument();
  });

  it("opens a key result from its row or its name", async () => {
    const user = userEvent.setup();
    const o = objective();
    table([o]);
    await user.click(screen.getByRole("button", { name: /Open key result/ }));
    expect(handlers.onOpenKr).toHaveBeenCalledWith(o.key_results[0], o);
  });

  it("offers to add and edit only to who may, and not once the cycle is closed", async () => {
    const user = userEvent.setup();
    const o = objective();
    const { rerender } = table([o]);
    await user.click(screen.getByRole("button", { name: `Add a key result to ${o.title}` }));
    expect(handlers.onAddKr).toHaveBeenCalledWith(o);
    await user.click(screen.getByRole("button", { name: `Edit ${o.title}` }));
    expect(handlers.onEditObjective).toHaveBeenCalledWith(o);

    rerender(
      <OkrTable objectives={[o]} mode="summary" cycleOpen={false} emptyText="x" {...handlers} />,
    );
    expect(screen.queryByRole("button", { name: /Add a key result/ })).not.toBeInTheDocument();
    rerender(
      <OkrTable
        objectives={[{ ...o, can_edit: false }]}
        mode="summary"
        cycleOpen
        emptyText="x"
        {...handlers}
      />,
    );
    expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
  });

  it("says so for an objective without key results", () => {
    table([objective({ key_results: [], progress: null })]);
    expect(screen.getByText(/No key results yet/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: /Progress of Make the shop/ })).not.toHaveAttribute(
      "aria-valuenow",
    );
  });

  it("explains an empty list", () => {
    table([]);
    expect(screen.getByText("Nothing here.")).toBeInTheDocument();
  });

  it("shows the score and the notes in the review, with the average on the objective", async () => {
    const user = userEvent.setup();
    const o = objective({
      can_review: true,
      score: null,
      key_results: [
        kr({ score: 0.8, merits: "Clear goal", to_improve: "Start earlier" }),
        kr({ id: "kr-2", title: "Second", score: 0.4 }),
      ],
    });
    table([o], "review");
    expect(screen.getByText("Score (0-1)")).toBeInTheDocument();
    expect(screen.getByText("Clear goal")).toBeInTheDocument();
    expect(screen.getByText("Start earlier")).toBeInTheDocument();
    expect(screen.getByText("avg 0.6")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: `Review ${o.title}` }));
    expect(handlers.onReviewObjective).toHaveBeenCalledWith(o);
    await user.click(screen.getByRole("button", { name: `Review ${o.key_results[0].title}` }));
    expect(handlers.onReviewKr).toHaveBeenCalledWith(o.key_results[0], o);
  });

  it("shows the score of an objective that was reviewed, and no review buttons for the owner", () => {
    table([objective({ score: 0.9, merits: "Great", can_review: false })], "review");
    expect(screen.getByText("0.9")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Review / })).not.toBeInTheDocument();
  });
});

// --- the tree ------------------------------------------------------------------------------------------------

describe("alignment", () => {
  const company = objective({ id: "o-c", title: "Be the best", level: "company", parent_id: null });
  const team = objective({ id: "o-t", title: "Sell online", level: "department", parent_id: "o-c" });
  const mine = objective({ id: "o-m", title: "Launch the shop", parent_id: "o-t" });

  it("puts each objective under the one it supports", () => {
    const tree = buildTree([mine, team, company]);
    expect(tree).toHaveLength(1);
    expect(tree[0].objective.id).toBe("o-c");
    expect(tree[0].children[0].objective.id).toBe("o-t");
    expect(tree[0].children[0].children[0].objective.id).toBe("o-m");
  });

  it("treats an objective whose parent is not in the list as a root", () => {
    expect(buildTree([mine]).map((n) => n.objective.id)).toEqual(["o-m"]);
  });

  it("draws the tree and opens the objectives the person may edit", async () => {
    const onOpen = vi.fn();
    render(<AlignmentTree objectives={[company, team, { ...mine, can_edit: false }]} onOpen={onOpen} />);
    expect(screen.getByRole("list", { name: "Alignment" })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Open Be the best" }));
    expect(onOpen).toHaveBeenCalledWith(company);
    expect(screen.queryByRole("button", { name: "Open Launch the shop" })).not.toBeInTheDocument();
    expect(screen.getByText("Launch the shop")).toBeInTheDocument();
  });

  it("explains an empty tree", () => {
    render(<AlignmentTree objectives={[]} onOpen={vi.fn()} />);
    expect(screen.getByText("No objective yet.")).toBeInTheDocument();
  });
});

// --- the screen -----------------------------------------------------------------------------------------------------

const listCyclesMock = vi.mocked(listCycles);
const getOverviewMock = vi.mocked(getOverview);

async function open(user = sampleUser({ id: "u-an" })) {
  vi.mocked(fetchMe).mockResolvedValue(user);
  render(
    <AuthProvider>
      <OkrScreen />
    </AuthProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fetchMe).mockResolvedValue(sampleUser({ id: "u-an" }));
  listCyclesMock.mockResolvedValue([CYCLE]);
  getOverviewMock.mockResolvedValue(overview([objective()]));
  vi.mocked(listOkrDepartments).mockResolvedValue([{ id: "d-1", name: "Sales", can_create: false }]);
  vi.mocked(listCheckIns).mockResolvedValue([]);
});

describe("OkrScreen", () => {
  it("shows the totals, the tabs and the objectives of the open cycle", async () => {
    await open();
    expect(await screen.findByRole("button", { name: HEADER })).toBeInTheDocument();
    const totals = screen.getByRole("list", { name: "Totals" });
    expect(within(totals).getByText("Average progress").previousSibling).toHaveTextContent("40%");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "OKR Summary",
      "Risky KRs",
      "Review",
    ]);
    expect(getOverviewMock).toHaveBeenCalledWith(
      { cycleId: "c-1", krStatus: undefined, level: null, mine: false },
      expect.anything(),
    );
  });

  it("asks only for the key results at risk in the risky tab", async () => {
    const user = userEvent.setup();
    await open();
    await screen.findByRole("button", { name: HEADER });
    await user.click(screen.getByRole("tab", { name: "Risky KRs" }));
    const exportLink = screen.getByRole("link", { name: "Export OKR to Excel" });
    const url = new URL(exportLink.getAttribute("href") ?? "", "http://localhost");
    expect(exportLink).toHaveAttribute("download");
    expect(url.pathname).toBe("/api/v1/okr/export");
    expect(url.searchParams.get("cycle_id")).toBe("c-1");
    expect(url.searchParams.getAll("kr_status")).toEqual(["at_risk", "off_track"]);
    await waitFor(() =>
      expect(getOverviewMock).toHaveBeenCalledWith(
        { cycleId: "c-1", krStatus: ["at_risk", "off_track"], level: null, mine: false },
        expect.anything(),
      ),
    );
  });

  it("narrows to one level or to what is mine", async () => {
    const user = userEvent.setup();
    await open();
    await screen.findByRole("button", { name: HEADER });
    await user.selectOptions(screen.getByLabelText("Filter by level"), "company");
    await waitFor(() =>
      expect(getOverviewMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ level: "company" }),
        expect.anything(),
      ),
    );
    await user.click(screen.getByRole("checkbox", { name: "Only mine" }));
    await waitFor(() =>
      expect(getOverviewMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ mine: true }),
        expect.anything(),
      ),
    );
  });

  it("shows the alignment tree and the review in their tabs", async () => {
    const user = userEvent.setup();
    await open();
    await screen.findByRole("button", { name: HEADER });
    await user.click(screen.getByRole("button", { name: "Alignment" }));
    expect(await screen.findByRole("list", { name: "Alignment" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("tab", { name: "Review" }));
    expect(await screen.findByText("Score (0-1)")).toBeInTheDocument();
  });

  it("starts on the open cycle and can switch to another", async () => {
    const old: Cycle = { ...CYCLE, id: "c-0", name: "2026 Q3", status: "closed", starts_on: "2026-07-01" };
    listCyclesMock.mockResolvedValue([old, CYCLE]);
    const user = userEvent.setup();
    await open();
    await screen.findByRole("button", { name: HEADER });
    expect(screen.getByLabelText("Cycle")).toHaveValue("c-1");
    await user.selectOptions(screen.getByLabelText("Cycle"), "c-0");
    await waitFor(() =>
      expect(getOverviewMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ cycleId: "c-0" }),
        expect.anything(),
      ),
    );
    expect(await screen.findByText(/This cycle is closed/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New objective" })).not.toBeInTheDocument();
  });

  it("tells a person that an admin opens the first cycle, and lets an admin do it", async () => {
    listCyclesMock.mockResolvedValue([]);
    const { unmount } = render(
      <AuthProvider>
        <OkrScreen />
      </AuthProvider>,
    );
    expect(await screen.findByText(/An admin opens a cycle/)).toBeInTheDocument();
    unmount();

    vi.mocked(fetchMe).mockResolvedValue(adminUser);
    render(
      <AuthProvider>
        <OkrScreen />
      </AuthProvider>,
    );
    expect(await screen.findByRole("button", { name: "Open the first cycle" })).toBeInTheDocument();
  });

  it("says when the OKRs cannot be read", async () => {
    getOverviewMock.mockRejectedValue(new ApiError("Not allowed", 403));
    await open();
    expect(await screen.findByText("Not allowed")).toBeInTheDocument();
  });
});

describe("making an objective", () => {
  it("makes a personal objective for the person, with the choices that are theirs", async () => {
    const user = userEvent.setup();
    vi.mocked(createObjective).mockResolvedValue(objective({ id: "o-new" }));
    await open();
    await screen.findByRole("button", { name: HEADER });
    await user.click(screen.getByRole("button", { name: "New objective" }));
    const level = screen.getByLabelText("Level");
    // Not an admin, not the head of a department: personal only.
    expect(within(level).getAllByRole("option").map((o) => o.textContent)).toEqual(["Personal"]);
    expect(screen.queryByLabelText("Owner: chosen")).not.toBeInTheDocument(); // only an admin picks

    const create = screen.getByRole("button", { name: "Create objective" });
    expect(create).toBeDisabled();
    await user.type(screen.getByLabelText(/^Objective/), "Grow the shop");
    await user.click(create);
    await waitFor(() =>
      expect(createObjective).toHaveBeenCalledWith({
        cycle_id: "c-1",
        title: "Grow the shop",
        description: null,
        level: "personal",
        department_id: null,
        parent_id: null,
        is_private: false,
      }),
    );
    // The lists are read again.
    await waitFor(() => expect(getOverviewMock.mock.calls.length).toBeGreaterThan(2));
  });

  it("lets an admin choose the level and the department, and asks for the department", async () => {
    const user = userEvent.setup();
    vi.mocked(createObjective).mockResolvedValue(objective({ id: "o-new" }));
    await open(adminUser);
    await screen.findByRole("button", { name: HEADER });
    await user.click(screen.getByRole("button", { name: "New objective" }));
    expect(
      within(screen.getByLabelText("Level")).getAllByRole("option").map((o) => o.textContent),
    ).toEqual(["Company", "Department", "Personal"]);
    await user.type(screen.getByLabelText(/^Objective/), "Sell more");
    await user.selectOptions(screen.getByLabelText("Level"), "department");
    expect(screen.getByRole("button", { name: "Create objective" })).toBeDisabled(); // no department
    await user.selectOptions(screen.getByLabelText("Department"), "d-1");
    await user.click(screen.getByRole("button", { name: "Create objective" }));
    await waitFor(() =>
      expect(createObjective).toHaveBeenCalledWith(
        expect.objectContaining({ level: "department", department_id: "d-1", title: "Sell more" }),
      ),
    );
  });

  it("shows why the server refused and stays open", async () => {
    const user = userEvent.setup();
    vi.mocked(createObjective).mockRejectedValue(new ApiError("Only an admin can make company objectives.", 403));
    await open();
    await screen.findByRole("button", { name: HEADER });
    await user.click(screen.getByRole("button", { name: "New objective" }));
    await user.type(screen.getByLabelText(/^Objective/), "Anything");
    await user.click(screen.getByRole("button", { name: "Create objective" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only an admin");
    expect(screen.getByRole("button", { name: "Create objective" })).toBeInTheDocument();
  });

  it("edits and deletes an objective of the person", async () => {
    const user = userEvent.setup();
    vi.mocked(updateObjective).mockResolvedValue(objective());
    vi.mocked(deleteObjective).mockResolvedValue();
    await open();
    await user.click(await screen.findByRole("button", { name: `Edit ${objective().title}` }));
    const title = screen.getByLabelText(/^Objective/);
    await user.clear(title);
    await user.type(title, "A better title");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(updateObjective).toHaveBeenCalledWith("o-1", expect.objectContaining({ title: "A better title" })),
    );

    await user.click(screen.getByRole("button", { name: `Edit ${objective().title}` }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Yes, delete" }));
    await waitFor(() => expect(deleteObjective).toHaveBeenCalledWith("o-1"));
  });
});

describe("key results and check-ins", () => {
  it("checks in on a key result with a value, how it is going and a note", async () => {
    const user = userEvent.setup();
    vi.mocked(checkIn).mockResolvedValue(objective());
    await open();
    await user.click(await screen.findByRole("button", { name: "Open key result Online orders per month" }));
    expect(await screen.findByText("No check-in yet.")).toBeInTheDocument();
    const value = screen.getByLabelText(/New value/);
    await user.clear(value);
    await user.type(value, "55");
    await user.selectOptions(screen.getByLabelText("How is it going?"), "at_risk");
    await user.type(screen.getByLabelText(/Note/), "Slower than planned");
    await user.click(screen.getByRole("button", { name: "Save check-in" }));
    await waitFor(() =>
      expect(checkIn).toHaveBeenCalledWith("kr-1", {
        value: 55,
        status: "at_risk",
        note: "Slower than planned",
      }),
    );
  });

  it("will not check in on a number that is not a number", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(await screen.findByRole("button", { name: /Open key result/ }));
    const value = screen.getByLabelText(/New value/);
    await user.clear(value);
    await user.type(value, "abc");
    expect(screen.getByRole("button", { name: "Save check-in" })).toBeDisabled();
  });

  it("shows the history of a key result", async () => {
    vi.mocked(listCheckIns).mockResolvedValue([
      {
        id: "ci-1",
        key_result_id: "kr-1",
        author: BINH,
        value: 30,
        status: "at_risk",
        note: "Waiting for stock",
        created_at: "2026-11-05T09:00:00Z",
      },
    ]);
    await open();
    await userEvent.setup().click(await screen.findByRole("button", { name: /Open key result/ }));
    const history = await screen.findByRole("region", { name: "History" });
    expect(within(history).getByText("Waiting for stock")).toBeInTheDocument();
    expect(within(history).getByText(/Tran Thi Binh/)).toBeInTheDocument();
  });

  it("does not offer a check-in to somebody who may not, nor in a closed cycle", async () => {
    getOverviewMock.mockResolvedValue(overview([objective({ key_results: [kr({ can_check_in: false })] })]));
    const user = userEvent.setup();
    await open();
    await user.click(await screen.findByRole("button", { name: /Open key result/ }));
    expect(screen.queryByRole("button", { name: "Save check-in" })).not.toBeInTheDocument();
    expect(screen.getByText(/Only the owner of this key result/)).toBeInTheDocument();
  });

  it("adds a key result with a start value, a target and a unit", async () => {
    const user = userEvent.setup();
    vi.mocked(createKeyResult).mockResolvedValue(objective());
    await open();
    await user.click(await screen.findByRole("button", { name: `Add a key result to ${objective().title}` }));
    const add = screen.getByRole("button", { name: "Add key result" });
    expect(add).toBeDisabled();
    await user.type(screen.getByLabelText(/^Key result/), "Customers");
    await user.type(screen.getByLabelText("Target"), "500");
    const start = screen.getByLabelText("Start value");
    await user.clear(start);
    await user.type(start, "100");
    await user.type(screen.getByLabelText("Unit"), "customers");
    await user.click(add);
    await waitFor(() =>
      expect(createKeyResult).toHaveBeenCalledWith("o-1", {
        title: "Customers",
        unit: "customers",
        start_value: 100,
        target_value: 500,
      }),
    );
  });

  it("will not add a key result whose target is its start value", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(await screen.findByRole("button", { name: `Add a key result to ${objective().title}` }));
    await user.type(screen.getByLabelText(/^Key result/), "Nothing to measure");
    await user.type(screen.getByLabelText("Target"), "0");
    expect(screen.getByRole("button", { name: "Add key result" })).toBeDisabled();
  });

  it("edits a key result from its panel", async () => {
    const user = userEvent.setup();
    vi.mocked(updateKeyResult).mockResolvedValue(objective());
    await open();
    await user.click(await screen.findByRole("button", { name: /Open key result/ }));
    await user.click(screen.getByRole("button", { name: "Edit key result" }));
    const target = screen.getByLabelText("Target");
    await user.clear(target);
    await user.type(target, "200");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(updateKeyResult).toHaveBeenCalledWith("kr-1", expect.objectContaining({ target_value: 200 })),
    );
  });
});

describe("the review", () => {
  it("writes the review of an objective and of a key result", async () => {
    const user = userEvent.setup();
    getOverviewMock.mockResolvedValue(overview([objective({ can_review: true })]));
    vi.mocked(reviewObjective).mockResolvedValue(objective());
    vi.mocked(reviewKeyResult).mockResolvedValue(objective());
    await open();
    await user.click(await screen.findByRole("tab", { name: "Review" }));

    await user.click(await screen.findByRole("button", { name: `Review ${objective().title}` }));
    await user.type(screen.getByLabelText(/^Score/), "0.8");
    await user.type(screen.getByLabelText("Review: merits"), "Clear goal");
    await user.click(screen.getByRole("button", { name: "Save review" }));
    await waitFor(() =>
      expect(reviewObjective).toHaveBeenCalledWith("o-1", {
        score: 0.8,
        merits: "Clear goal",
        to_improve: null,
      }),
    );

    await user.click(await screen.findByRole("button", { name: `Review ${kr().title}` }));
    await user.type(screen.getByLabelText(/^Score/), "0.5");
    await user.click(screen.getByRole("button", { name: "Save review" }));
    await waitFor(() =>
      expect(reviewKeyResult).toHaveBeenCalledWith("kr-1", { score: 0.5, merits: null, to_improve: null }),
    );
  });

  it("will not take a score above 1", async () => {
    const user = userEvent.setup();
    getOverviewMock.mockResolvedValue(overview([objective({ can_review: true })]));
    await open();
    await user.click(await screen.findByRole("tab", { name: "Review" }));
    await user.click(await screen.findByRole("button", { name: `Review ${objective().title}` }));
    await user.type(screen.getByLabelText(/^Score/), "1.5");
    expect(screen.getByRole("button", { name: "Save review" })).toBeDisabled();
  });

  it("can still be written once the cycle is closed", async () => {
    const closed: Cycle = { ...CYCLE, status: "closed" };
    listCyclesMock.mockResolvedValue([closed]);
    getOverviewMock.mockResolvedValue({ ...overview([objective({ can_review: true })]), cycle: closed });
    const user = userEvent.setup();
    await open();
    await user.click(await screen.findByRole("tab", { name: "Review" }));
    expect(await screen.findByRole("button", { name: `Review ${objective().title}` })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New objective" })).not.toBeInTheDocument();
  });
});

describe("cycles", () => {
  it("is for admins: opens, closes, reopens and deletes a cycle", async () => {
    const user = userEvent.setup();
    vi.mocked(createCycle).mockResolvedValue({ ...CYCLE, id: "c-2", name: "2027 Q1" });
    vi.mocked(updateCycle).mockResolvedValue({ ...CYCLE, status: "closed" });
    vi.mocked(deleteCycle).mockResolvedValue();
    await open(adminUser);
    await user.click(await screen.findByRole("button", { name: "Cycles" }));

    await user.type(screen.getByLabelText("Name"), "2027 Q1");
    await user.type(screen.getByLabelText("Starts on"), "2027-01-01");
    await user.type(screen.getByLabelText("Ends on"), "2027-03-31");
    await user.click(screen.getByRole("button", { name: "Open cycle" }));
    await waitFor(() =>
      expect(createCycle).toHaveBeenCalledWith({
        name: "2027 Q1",
        starts_on: "2027-01-01",
        ends_on: "2027-03-31",
      }),
    );

    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(updateCycle).toHaveBeenCalledWith("c-1", { status: "closed" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Yes, delete" }));
    await waitFor(() => expect(deleteCycle).toHaveBeenCalledWith("c-1"));
  });

  it("does not offer cycles to a person who is not an admin", async () => {
    await open();
    await screen.findByRole("button", { name: HEADER });
    expect(screen.queryByRole("button", { name: "Cycles" })).not.toBeInTheDocument();
  });

  it("will not open a cycle that ends before it starts", async () => {
    const user = userEvent.setup();
    await open(adminUser);
    await user.click(await screen.findByRole("button", { name: "Cycles" }));
    await user.type(screen.getByLabelText("Name"), "Odd");
    await user.type(screen.getByLabelText("Starts on"), "2027-03-31");
    await user.type(screen.getByLabelText("Ends on"), "2027-01-01");
    expect(screen.getByRole("button", { name: "Open cycle" })).toBeDisabled();
  });
});
