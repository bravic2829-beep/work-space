"use client";

import { Gauge, Settings2 } from "lucide-react";
import { useState } from "react";

import {
  Alert,
  Avatar,
  Button,
  EmptyState,
  Input,
  LoadingState,
  Select,
} from "@/components/ui";
import { listOkrDepartments } from "@/features/okr/api";
import { cn } from "@/lib/cn";
import { useApiResource } from "@/lib/useApiResource";

import { getCriteria, getScores } from "./api";
import { CriteriaDrawer } from "./CriteriaDrawer";
import { monthOf, type CriterionScore, type PersonScore } from "./schema";
import { ScoreDrawer } from "./ScoreDrawer";

/** A score as a whole number; null is "no score", never a zero. */
const shown = (score: number | null) => (score === null ? "—" : String(Math.round(score)));

function tone(score: number | null): string {
  if (score === null) return "text-muted";
  if (score >= 80) return "text-success";
  if (score < 50) return "text-danger";
  return "text-fg";
}

type Open =
  | { kind: "criteria" }
  | { kind: "score"; person: PersonScore; criterionId: string; current: CriterionScore };

/**
 * Performance: the score of each person for a month, from criteria with weights. Some criteria are
 * worked out from the tasks, the others are scored by the manager with a reason. A criterion with
 * nothing to judge shows a dash and is left out of the total (never counted as a zero).
 */
export function PerformanceScreen() {
  const [month, setMonth] = useState(() => monthOf(new Date()));
  const [departmentId, setDepartmentId] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [open, setOpen] = useState<Open | null>(null);
  const departments = useApiResource(listOkrDepartments, "Could not load the departments.", []);
  const criteria = useApiResource(getCriteria, "Could not load the criteria.", [refresh]);
  const result = useApiResource(
    (signal) => getScores({ period: month, departmentId }, signal),
    "Could not load the scores.",
    [month, departmentId, refresh],
  );

  const again = () => setRefresh((n) => n + 1);
  const canManage = criteria.kind === "ready" && criteria.data.can_manage;
  const data = result.kind === "ready" ? result.data : null;
  const scoredCriterion =
    open?.kind === "score" ? data?.criteria.find((c) => c.id === open.criterionId) : undefined;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-[12px] font-medium text-muted">
            Month
            <Input
              type="month"
              className="w-40"
              value={month}
              onChange={(event) => event.target.value && setMonth(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-[12px] font-medium text-muted">
            Department
            <Select
              className="w-52"
              value={departmentId}
              onChange={(event) => setDepartmentId(event.target.value)}
            >
              <option value="">All departments</option>
              {(departments.kind === "ready" ? departments.data : []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </label>
        </div>
        {canManage && (
          <Button icon={Settings2} onClick={() => setOpen({ kind: "criteria" })}>
            Criteria and weights
          </Button>
        )}
      </div>

      {result.kind === "loading" && <LoadingState>Calculating…</LoadingState>}
      {result.kind === "error" && <Alert>{result.message}</Alert>}
      {data && data.people.length === 0 && (
        <EmptyState icon={Gauge} title="Nobody to show.">
          You see yourself and the people you manage. Admins see everybody.
        </EmptyState>
      )}
      {data && data.people.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="m-0">
            <thead>
              <tr>
                <th scope="col">Employee</th>
                {data.criteria.map((c) => (
                  <th key={c.id} scope="col" className="text-right">
                    {c.name} <span className="font-normal text-muted">{c.weight}%</span>
                  </th>
                ))}
                <th scope="col" className="text-right">Total</th>
                <th scope="col" className="text-right">Judged</th>
              </tr>
            </thead>
            <tbody>
              {data.people.map((p) => {
                const byCriterion = new Map(p.scores.map((s) => [s.criterion_id, s]));
                return (
                  <tr key={p.user_id}>
                    <td>
                      <span className="inline-flex items-center gap-2">
                        <Avatar name={p.full_name} className="size-6 text-[10px]" />
                        {p.full_name}
                        <span className="font-mono text-[11px] text-muted">{p.employee_code}</span>
                      </span>
                    </td>
                    {data.criteria.map((c) => {
                      const s = byCriterion.get(c.id);
                      if (!s) return <td key={c.id} />;
                      const writable = c.metric === null && p.can_score;
                      const text = (
                        <span className={cn("tabular-nums", tone(s.score))}>{shown(s.score)}</span>
                      );
                      return (
                        <td key={c.id} className="text-right" title={s.reason ? `${s.detail}: ${s.reason}` : s.detail}>
                          {writable ? (
                            <button
                              type="button"
                              aria-label={`${c.name} for ${p.full_name}: ${shown(s.score)}. Score it`}
                              className="rounded px-1.5 py-0.5 hover:bg-surface-muted"
                              onClick={() => setOpen({ kind: "score", person: p, criterionId: c.id, current: s })}
                            >
                              {text}
                            </button>
                          ) : (
                            text
                          )}
                        </td>
                      );
                    })}
                    <td className={cn("text-right font-semibold tabular-nums", tone(p.total))}>
                      {shown(p.total)}
                    </td>
                    <td className="text-right text-xs text-muted tabular-nums">
                      {Math.round(p.coverage * 100)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {criteria.kind === "ready" && (
        <section aria-label="How scores are worked out" className="grid gap-2">
          <h2 className="m-0 text-base">How a score is worked out</h2>
          <p className="m-0 text-xs text-muted">
            Each criterion gives 0 to 100. The total is the sum of score × weight, divided by the weight of
            the criteria that have a score: a criterion with nothing to judge is left out, never counted as
            a zero, and “Judged” says how much of the weight was scored. Task-based numbers count only
            the tasks you may open. Scores describe the work; they do not decide rewards by themselves.
          </p>
          <ul className="m-0 grid list-none gap-1 p-0 text-[13px]">
            {criteria.data.criteria
              .filter((c) => c.is_active)
              .map((c) => (
                <li key={c.id}>
                  <b>{c.name}</b> · {c.weight}% ·{" "}
                  <span className="text-muted">
                    {c.metric
                      ? (criteria.data.metrics.find((m) => m.id === c.metric)?.description ?? c.metric)
                      : "Scored by a person, with a reason"}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      )}

      {open?.kind === "criteria" && criteria.kind === "ready" && (
        <CriteriaDrawer
          criteria={criteria.data}
          onChanged={again}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === "score" && scoredCriterion && (
        <ScoreDrawer
          person={open.person}
          criterion={scoredCriterion}
          current={open.current}
          period={month}
          onSaved={() => {
            setOpen(null);
            again();
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
