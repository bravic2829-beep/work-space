import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listOkrDepartments } from "@/features/okr/api";

import {
  createCriterion,
  getCriteria,
  getHistory,
  getScores,
  setScore,
  updateCriterion,
} from "./api";
import { PerformanceScreen } from "./PerformanceScreen";
import { isCriteria, isScores, type Criteria, type Scores } from "./schema";

vi.mock("@/features/okr/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/okr/api")>()),
  listOkrDepartments: vi.fn(),
}));
vi.mock("./api", () => ({
  getCriteria: vi.fn(),
  getScores: vi.fn(),
  createCriterion: vi.fn(),
  updateCriterion: vi.fn(),
  getHistory: vi.fn(),
  setScore: vi.fn(),
}));

const criteria: Criteria = {
  criteria: [
    { id: "c-1", name: "Task completion", description: "Done tasks", weight: 25, metric: "completion_rate", is_active: true, position: 0 },
    { id: "c-2", name: "Initiative", description: null, weight: 15, metric: null, is_active: true, position: 1 },
  ],
  total_weight: 40,
  can_manage: true,
  metrics: [
    { id: "completion_rate", label: "Completion rate", description: "Done tasks / tasks of the month", measurable: true },
    { id: "update_compliance", label: "Update compliance", description: "Not yet", measurable: false },
  ],
};

const scores: Scores = {
  period: "2026-11",
  criteria: criteria.criteria,
  people: [
    {
      user_id: "u-1",
      full_name: "Nguyen Van An",
      employee_code: "NV001",
      scores: [
        { criterion_id: "c-1", score: 80, source: "auto", detail: "8 of 10 tasks done", reason: null },
        { criterion_id: "c-2", score: null, source: "none", detail: "Not scored yet", reason: null },
      ],
      total: 80,
      coverage: 0.625,
      can_score: true,
    },
    {
      user_id: "u-2",
      full_name: "Tran Thi Binh",
      employee_code: "NV002",
      scores: [
        { criterion_id: "c-1", score: null, source: "none", detail: "0 of 0 tasks done", reason: null },
        { criterion_id: "c-2", score: 40, source: "manual", detail: "Scored by a person", reason: "Late updates" },
      ],
      total: 40,
      coverage: 0.375,
      can_score: false,
    },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listOkrDepartments).mockResolvedValue([{ id: "d-1", name: "Sales", can_create: false }]);
  vi.mocked(getCriteria).mockResolvedValue(criteria);
  vi.mocked(getScores).mockResolvedValue(scores);
});

describe("PerformanceScreen", () => {
  it("shows each person with a score per criterion, a total and how much was judged", async () => {
    render(<PerformanceScreen />);
    const an = (await screen.findByText("Nguyen Van An")).closest("tr")!;
    expect(within(an).getByText("80", { selector: "td:nth-of-type(2) span" })).toBeInTheDocument();
    // Nothing was scored for the second criterion: a dash, not a zero.
    expect(within(an).getAllByText("—")).toHaveLength(1);
    expect(within(an).getByText("63%")).toBeInTheDocument();
    const binh = screen.getByText("Tran Thi Binh").closest("tr")!;
    expect(within(binh).getByText("—")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Task completion 25%/ })).toBeInTheDocument();
  });

  it("asks for the month and the department that were chosen", async () => {
    const user = userEvent.setup();
    render(<PerformanceScreen />);
    await screen.findByText("Nguyen Van An");
    await user.selectOptions(screen.getByLabelText("Department"), "d-1");
    await waitFor(() =>
      expect(getScores).toHaveBeenLastCalledWith(
        expect.objectContaining({ departmentId: "d-1" }),
        expect.anything(),
      ),
    );
  });

  it("lets a manager score a criterion that is scored by a person, with a reason", async () => {
    const user = userEvent.setup();
    vi.mocked(setScore).mockResolvedValue(undefined);
    render(<PerformanceScreen />);
    await user.click(await screen.findByRole("button", { name: /Initiative for Nguyen Van An/ }));
    const save = screen.getByRole("button", { name: "Save score" });
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText("Score (0 to 100)"), "75");
    await user.type(screen.getByLabelText("Reason"), "Raised two risks early");
    await user.click(save);
    await waitFor(() =>
      expect(setScore).toHaveBeenCalledWith({
        criterion_id: "c-2",
        user_id: "u-1",
        period: expect.stringMatching(/^\d{4}-\d{2}$/),
        score: 75,
        reason: "Raised two risks early",
      }),
    );
    // The drawer closes and the scores are read again.
    await waitFor(() => expect(getScores).toHaveBeenCalledTimes(2));
  });

  it("does not offer to score what is measured from tasks, or a person one may not score", async () => {
    render(<PerformanceScreen />);
    await screen.findByText("Nguyen Van An");
    expect(screen.queryByRole("button", { name: /Task completion for/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Initiative for Tran Thi Binh/ })).not.toBeInTheDocument();
  });

  it("hides the criteria button from somebody who may not manage them", async () => {
    vi.mocked(getCriteria).mockResolvedValue({ ...criteria, can_manage: false });
    render(<PerformanceScreen />);
    await screen.findByText("Nguyen Van An");
    expect(screen.queryByRole("button", { name: "Criteria and weights" })).not.toBeInTheDocument();
  });

  it("lets an admin change a weight with a reason, add a criterion and read the history", async () => {
    const user = userEvent.setup();
    vi.mocked(updateCriterion).mockResolvedValue(criteria.criteria[0]!);
    vi.mocked(createCriterion).mockResolvedValue(criteria.criteria[1]!);
    vi.mocked(getHistory).mockResolvedValue([
      {
        id: "h-1",
        actor_name: "Admin",
        changes: { weight: { from: 20, to: 25 } },
        reason: "New plan",
        created_at: "2026-11-01T10:00:00Z",
      },
    ]);
    render(<PerformanceScreen />);
    await user.click(await screen.findByRole("button", { name: "Criteria and weights" }));
    const list = within(screen.getByRole("list", { name: "Criteria" }));
    expect(screen.getByText(/add up to 40, not 100/)).toBeInTheDocument();

    await user.click(list.getAllByRole("button", { name: "Edit" })[0]!);
    // The form of the criterion being edited is the first; the one that adds is the last.
    const weight = screen.getAllByLabelText("Weight (0 to 100)")[0]!;
    await user.clear(weight);
    await user.type(weight, "30");
    await user.type(screen.getByLabelText(/Reason for the change/), "More focus on output");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(updateCriterion).toHaveBeenCalledWith(
        "c-1",
        expect.objectContaining({ weight: 30, metric: "completion_rate", reason: "More focus on output" }),
      ),
    );

    await user.click(list.getAllByRole("button", { name: "History" })[0]!);
    expect(await screen.findByText(/weight 20 → 25/)).toBeInTheDocument();
    expect(screen.getByText("(New plan)")).toBeInTheDocument();

    await user.type(screen.getAllByLabelText("Name").at(-1)!, "Customer feedback");
    await user.click(screen.getByRole("button", { name: "Add criterion" }));
    await waitFor(() =>
      expect(createCriterion).toHaveBeenCalledWith({
        name: "Customer feedback",
        description: null,
        weight: 10,
        metric: null,
      }),
    );
  });

  it("refuses a weight above 100 and a measure that cannot be measured", async () => {
    const user = userEvent.setup();
    render(<PerformanceScreen />);
    await user.click(await screen.findByRole("button", { name: "Criteria and weights" }));
    const form = screen.getByRole("button", { name: "Add criterion" }).closest("form")!;
    await user.type(within(form).getByLabelText("Name"), "X");
    const weight = within(form).getByLabelText("Weight (0 to 100)");
    await user.clear(weight);
    await user.type(weight, "101");
    expect(screen.getByRole("button", { name: "Add criterion" })).toBeDisabled();
    expect(
      within(form).getByRole("option", { name: /Update compliance \(not measurable yet\)/ }),
    ).toBeDisabled();
  });
});

describe("guards", () => {
  it("accept what the server sends and refuse the rest", () => {
    expect(isCriteria(criteria)).toBe(true);
    expect(isCriteria({ ...criteria, total_weight: "40" })).toBe(false);
    expect(isScores(scores)).toBe(true);
    expect(isScores({ ...scores, people: [{ user_id: 1 }] })).toBe(false);
    expect(isScores(null)).toBe(false);
  });
});
