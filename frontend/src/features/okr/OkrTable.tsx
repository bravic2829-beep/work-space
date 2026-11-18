"use client";

import { ChevronDown, ChevronRight, ClipboardCheck, Lock, Pencil, Plus, Target } from "lucide-react";
import { Fragment, useState } from "react";

import { Avatar, Badge, Button, DataTable, EmptyState, plainName } from "@/components/ui";

import { ProgressBar, StatusPill } from "./Progress";
import {
  averageScore,
  formatValue,
  LEVEL_LABELS,
  scoreText,
  type KeyResult,
  type Objective,
} from "./schema";

export type TableMode = "summary" | "review";

type Props = {
  objectives: Objective[];
  mode: TableMode;
  /** False once the cycle is closed: nothing can be added or changed, only reviewed. */
  cycleOpen: boolean;
  /** Said when there is nothing to show: depends on the tab. */
  emptyText: string;
  onOpenKr: (kr: KeyResult, objective: Objective) => void;
  onAddKr: (objective: Objective) => void;
  onEditObjective: (objective: Objective) => void;
  onReviewObjective: (objective: Objective) => void;
  onReviewKr: (kr: KeyResult, objective: Objective) => void;
};

const MERITS = "Review: merits";
const IMPROVE = "Review: to improve";

function Person({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Avatar name={name} className="size-5 text-[10px]" />
      {plainName(name)}
    </span>
  );
}

/** Long text in a cell: cut to one line, the whole text on hover. */
function Note({ text }: { text: string | null }) {
  if (!text) return <span className="text-line-strong">—</span>;
  return (
    <span className="block max-w-64 truncate" title={text}>
      {text}
    </span>
  );
}

/**
 * The objectives with their key results under each, like the grid of the design: a header row per
 * objective (its progress, and in the review its score) and one row per key result. Opening a key
 * result is how a person checks in.
 */
export function OkrTable({
  objectives,
  mode,
  cycleOpen,
  emptyText,
  onOpenKr,
  onAddKr,
  onEditObjective,
  onReviewObjective,
  onReviewKr,
}: Props) {
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const review = mode === "review";

  if (objectives.length === 0) {
    return (
      <EmptyState icon={Target} title="Nothing to show.">
        {emptyText}
      </EmptyState>
    );
  }

  function toggle(id: string) {
    setClosed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <DataTable dense aria-label={review ? "OKR review" : "OKR summary"}>
      <thead>
        <tr>
          <th scope="col" className="min-w-72">
            Key result
          </th>
          <th scope="col">Owner</th>
          <th scope="col">Status</th>
          <th scope="col">Progress</th>
          {review ? (
            <>
              <th scope="col" className="text-right">
                Score (0-1)
              </th>
              <th scope="col">{MERITS}</th>
              <th scope="col">{IMPROVE}</th>
            </>
          ) : (
            <th scope="col" className="text-right">
              Now / target
            </th>
          )}
          <th scope="col">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {objectives.map((objective) => {
          const open = !closed.has(objective.id);
          const Chevron = open ? ChevronDown : ChevronRight;
          const average = averageScore(objective);
          return (
            <Fragment key={objective.id}>
              <tr className="bg-surface-muted" data-objective={objective.id}>
                <td>
                  <button
                    type="button"
                    aria-expanded={open}
                    className="h-auto max-w-full justify-start gap-1.5 border-0 bg-transparent p-0 font-semibold text-fg hover:bg-transparent"
                    onClick={() => toggle(objective.id)}
                  >
                    <Chevron className="size-4 shrink-0 text-muted" aria-hidden />
                    <span className="truncate">{objective.title}</span>{" "}
                    <span className="text-xs font-normal text-muted">
                      {objective.key_results.length}{" "}
                      {objective.key_results.length === 1 ? "key result" : "key results"}
                    </span>
                  </button>
                </td>
                <td>
                  <span className="inline-flex items-center gap-2">
                    <Person name={objective.owner.full_name} />
                    <Badge tone="info">
                      {objective.department?.name ?? LEVEL_LABELS[objective.level]}
                    </Badge>
                    {objective.is_private && (
                      <Lock className="size-3.5 text-muted" aria-label="Private objective" />
                    )}
                  </span>
                </td>
                <td />
                <td>
                  <ProgressBar value={objective.progress} label={`Progress of ${objective.title}`} />
                </td>
                {review ? (
                  <>
                    <td className="text-right tabular-nums">
                      {objective.score !== null ? (
                        <b>{scoreText(objective.score)}</b>
                      ) : (
                        <span className="text-muted" title="Average of the key results">
                          {average !== null ? `avg ${scoreText(average)}` : "—"}
                        </span>
                      )}
                    </td>
                    <td>
                      <Note text={objective.merits} />
                    </td>
                    <td>
                      <Note text={objective.to_improve} />
                    </td>
                  </>
                ) : (
                  <td />
                )}
                <td className="text-right">
                  <span className="inline-flex items-center gap-1">
                    {cycleOpen && objective.can_edit && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        aria-label={`Add a key result to ${objective.title}`}
                        title="Add a key result"
                        onClick={() => onAddKr(objective)}
                      >
                        <Plus className="size-4" aria-hidden />
                      </Button>
                    )}
                    {objective.can_edit && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        aria-label={`Edit ${objective.title}`}
                        title="Edit the objective"
                        onClick={() => onEditObjective(objective)}
                      >
                        <Pencil className="size-4" aria-hidden />
                      </Button>
                    )}
                    {review && objective.can_review && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        aria-label={`Review ${objective.title}`}
                        title="Review the objective"
                        onClick={() => onReviewObjective(objective)}
                      >
                        <ClipboardCheck className="size-4" aria-hidden />
                      </Button>
                    )}
                  </span>
                </td>
              </tr>
              {open &&
                objective.key_results.map((kr) => (
                  <tr
                    key={kr.id}
                    className="cursor-pointer"
                    onClick={(event) => {
                      if (!(event.target as HTMLElement).closest("button, a")) onOpenKr(kr, objective);
                    }}
                  >
                    <td className="pl-9">
                      <button
                        type="button"
                        className="h-auto max-w-full justify-start border-0 bg-transparent p-0 font-medium text-primary hover:bg-transparent hover:underline"
                        aria-label={`Open key result ${kr.title}`}
                        onClick={() => onOpenKr(kr, objective)}
                      >
                        <span className="truncate">{kr.title}</span>
                      </button>
                    </td>
                    <td>
                      <Person name={kr.owner.full_name} />
                    </td>
                    <td>
                      <StatusPill status={kr.status} />
                    </td>
                    <td>
                      <ProgressBar value={kr.progress} label={`Progress of ${kr.title}`} />
                    </td>
                    {review ? (
                      <>
                        <td className="text-right tabular-nums">{scoreText(kr.score)}</td>
                        <td>
                          <Note text={kr.merits} />
                        </td>
                        <td>
                          <Note text={kr.to_improve} />
                        </td>
                      </>
                    ) : (
                      <td className="text-right text-xs tabular-nums">
                        {formatValue(kr.current_value, kr.unit)}
                        <span className="text-muted"> / {formatValue(kr.target_value, kr.unit)}</span>
                      </td>
                    )}
                    <td className="text-right">
                      {review && objective.can_review && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          aria-label={`Review ${kr.title}`}
                          title="Review the key result"
                          onClick={() => onReviewKr(kr, objective)}
                        >
                          <ClipboardCheck className="size-4" aria-hidden />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              {open && objective.key_results.length === 0 && (
                <tr>
                  <td colSpan={review ? 8 : 6} className="pl-9 text-sm text-muted">
                    No key results yet.
                    {cycleOpen && objective.can_edit && " Use + to add the first."}
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </DataTable>
  );
}
