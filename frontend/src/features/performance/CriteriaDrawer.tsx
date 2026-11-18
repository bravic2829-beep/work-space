"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Drawer,
  DrawerBody,
  FormField,
  Input,
  Select,
  Textarea,
} from "@/components/ui";
import { firstProblem } from "@/lib/api/errors";
import { useApiResource } from "@/lib/useApiResource";
import { useAsyncAction } from "@/lib/useAsyncAction";

import { createCriterion, getHistory, updateCriterion } from "./api";
import { METRIC_IDS, type Criteria, type Criterion, type MetricId } from "./schema";

type Props = {
  criteria: Criteria;
  /** A criterion was added or changed: read the scores again. */
  onChanged: () => void;
  onClose: () => void;
};

/** What the form holds while it is being filled in. */
type Draft = {
  name: string;
  description: string;
  weight: string;
  /** "" means scored by a person. */
  metric: string;
  active: boolean;
  reason: string;
};

const EMPTY: Draft = { name: "", description: "", weight: "10", metric: "", active: true, reason: "" };

function draftOf(c: Criterion): Draft {
  return {
    name: c.name,
    description: c.description ?? "",
    weight: String(c.weight),
    metric: c.metric ?? "",
    active: c.is_active,
    reason: "",
  };
}

const validWeight = (text: string) => /^\d{1,3}$/.test(text) && Number(text) <= 100;

function CriterionForm({
  draft,
  onChange,
  criteria,
  showActive,
}: {
  draft: Draft;
  onChange: (next: Draft) => void;
  criteria: Criteria;
  showActive: boolean;
}) {
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  return (
    <div className="grid gap-3">
      <FormField label="Name">
        <Input value={draft.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} />
      </FormField>
      <FormField label="What it looks at">
        <Textarea
          rows={2}
          value={draft.description}
          maxLength={2000}
          onChange={(e) => set({ description: e.target.value })}
        />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Weight (0 to 100)">
          <Input
            inputMode="numeric"
            value={draft.weight}
            invalid={!validWeight(draft.weight)}
            onChange={(e) => set({ weight: e.target.value })}
          />
        </FormField>
        <FormField label="Where the score comes from">
          <Select value={draft.metric} onChange={(e) => set({ metric: e.target.value })}>
            <option value="">Scored by a person</option>
            {criteria.metrics.map((m) => (
              <option key={m.id} value={m.id} disabled={!m.measurable}>
                {m.label}
                {m.measurable ? "" : " (not measurable yet)"}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      {showActive && (
        <Checkbox
          label="Counts towards the score"
          checked={draft.active}
          onChange={(e) => set({ active: e.target.checked })}
        />
      )}
      {showActive && (
        <FormField label="Reason for the change (kept in the history)">
          <Input value={draft.reason} maxLength={2000} onChange={(e) => set({ reason: e.target.value })} />
        </FormField>
      )}
    </div>
  );
}

function History({ id }: { id: string }) {
  const history = useApiResource((signal) => getHistory(id, signal), "Could not load the history.", [id]);
  if (history.kind === "loading") return <p className="m-0 text-xs text-muted">Loading…</p>;
  if (history.kind === "error") return <Alert>{history.message}</Alert>;
  return (
    <ul aria-label="History" className="m-0 grid list-none gap-1 p-0 text-xs">
      {history.data.map((h) => (
        <li key={h.id} className="rounded-md bg-surface-muted px-2.5 py-1.5">
          <b>{new Date(h.created_at).toLocaleDateString()}</b> · {h.actor_name}:{" "}
          {Object.entries(h.changes)
            .map(([key, value]) => {
              const change = value as { from?: unknown; to?: unknown } | null;
              return change && "to" in change
                ? `${key} ${String(change.from)} → ${String(change.to)}`
                : `${key} set`;
            })
            .join(", ")}
          {h.reason && <span className="text-muted"> ({h.reason})</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * For admins: the criteria people are judged on. Change the weight or the source, switch a
 * criterion off, add a new one. Every change is kept with who made it and why.
 */
export function CriteriaDrawer({ criteria, onChanged, onClose }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [added, setAdded] = useState<Draft>(EMPTY);
  const { busy, message, run } = useAsyncAction();

  const valid = (d: Draft) => d.name.trim() !== "" && validWeight(d.weight);
  const metricOf = (d: Draft): MetricId | null =>
    METRIC_IDS.includes(d.metric) ? (d.metric as MetricId) : null;

  async function save(c: Criterion) {
    await run(
      async () => {
        await updateCriterion(c.id, {
          name: draft.name.trim(),
          description: draft.description.trim() || null,
          weight: Number(draft.weight),
          metric: metricOf(draft),
          is_active: draft.active,
          ...(draft.reason.trim() ? { reason: draft.reason.trim() } : {}),
        });
        setEditing(null);
        onChanged();
      },
      (error) => firstProblem(error, "Could not save the criterion."),
    );
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!valid(added)) return;
    await run(
      async () => {
        await createCriterion({
          name: added.name.trim(),
          description: added.description.trim() || null,
          weight: Number(added.weight),
          metric: metricOf(added),
        });
        setAdded(EMPTY);
        onChanged();
      },
      (error) => firstProblem(error, "Could not add the criterion."),
    );
  }

  return (
    <Drawer
      open
      title="Performance criteria"
      subtitle={`Active weights add up to ${criteria.total_weight}`}
      onClose={onClose}
    >
      <DrawerBody>
        {criteria.total_weight !== 100 && (
          <Alert tone="info">
            The weights add up to {criteria.total_weight}, not 100. That works: a score is divided by the
            weight that was judged.
          </Alert>
        )}
        <ul aria-label="Criteria" className="m-0 grid list-none gap-2 p-0">
          {criteria.criteria.map((c) => (
            <li key={c.id} className="grid gap-2 rounded-md border border-line px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{c.name}</span>
                <Badge tone="info">{c.weight}%</Badge>
                <Badge tone="neutral">
                  {c.metric
                    ? (criteria.metrics.find((m) => m.id === c.metric)?.label ?? c.metric)
                    : "Scored by a person"}
                </Badge>
                {!c.is_active && <Badge tone="warning">Off</Badge>}
                <span className="ml-auto flex gap-1">
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditing(editing === c.id ? null : c.id);
                      setDraft(draftOf(c));
                    }}
                  >
                    {editing === c.id ? "Cancel" : "Edit"}
                  </Button>
                  <Button size="sm" onClick={() => setShowHistory(showHistory === c.id ? null : c.id)}>
                    History
                  </Button>
                </span>
              </div>
              {c.description && <p className="m-0 text-xs text-muted">{c.description}</p>}
              {editing === c.id && (
                <div className="grid gap-3 border-t border-line pt-3">
                  <CriterionForm draft={draft} onChange={setDraft} criteria={criteria} showActive />
                  <div>
                    <Button
                      variant="primary"
                      loading={busy}
                      disabled={!valid(draft)}
                      onClick={() => void save(c)}
                    >
                      Save changes
                    </Button>
                  </div>
                </div>
              )}
              {showHistory === c.id && <History id={c.id} />}
            </li>
          ))}
        </ul>

        <form onSubmit={(event) => void add(event)} className="grid gap-3 rounded-lg border border-line p-3">
          <h3 className="m-0 text-sm">Add a criterion</h3>
          <CriterionForm draft={added} onChange={setAdded} criteria={criteria} showActive={false} />
          <div>
            <Button type="submit" variant="primary" icon={Plus} loading={busy} disabled={!valid(added)}>
              Add criterion
            </Button>
          </div>
        </form>
        {message && <Alert>{message}</Alert>}
      </DrawerBody>
    </Drawer>
  );
}
