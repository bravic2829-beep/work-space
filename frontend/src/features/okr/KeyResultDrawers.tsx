"use client";

import { Pencil, Save, Send } from "lucide-react";
import { useState } from "react";

import {
  Alert,
  Button,
  Drawer,
  DrawerBody,
  DrawerFooter,
  FormField,
  InlineConfirm,
  Input,
  LoadingState,
  Select,
  Textarea,
} from "@/components/ui";
import { UserPicker } from "@/features/tables/UserPicker";
import { formatDateTime } from "@/lib/format";
import { firstProblem } from "@/lib/api/errors";
import { useApiResource } from "@/lib/useApiResource";
import { useAsyncAction } from "@/lib/useAsyncAction";

import {
  checkIn,
  createKeyResult,
  deleteKeyResult,
  listCheckIns,
  updateKeyResult,
  type ReviewInput,
} from "./api";
import { ProgressBar, StatusPill } from "./Progress";
import {
  formatValue,
  STATUS_LABELS,
  STATUSES,
  type KeyResult,
  type KrStatus,
  type Objective,
} from "./schema";

/** A number typed in a box, or null when it is not one. */
function parse(text: string): number | null {
  if (text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

// --- add or change a key result ----------------------------------------------------------------------

type FormProps = {
  objective: Objective;
  /** The key result being changed, or null to add one. */
  kr: KeyResult | null;
  onSaved: (objective: Objective) => void;
  onDeleted: () => void;
  onClose: () => void;
};

/** A key result says how to measure the objective: a start value, a target and the unit. */
export function KeyResultDrawer({ objective, kr, onSaved, onDeleted, onClose }: FormProps) {
  const [title, setTitle] = useState(kr?.title ?? "");
  const [unit, setUnit] = useState(kr?.unit ?? "");
  const [start, setStart] = useState(String(kr?.start_value ?? 0));
  const [target, setTarget] = useState(kr ? String(kr.target_value) : "");
  const [owner, setOwner] = useState<string[]>(kr ? [kr.owner.id] : []);
  const { busy, message, run } = useAsyncAction();

  const from = parse(start);
  const to = parse(target);
  const valid = title.trim() !== "" && from !== null && to !== null && from !== to;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!valid || from === null || to === null) return;
    await run(
      async () => {
        const body = {
          title: title.trim(),
          unit: unit.trim(),
          start_value: from,
          target_value: to,
          ...(owner[0] ? { owner_id: owner[0] } : {}),
        };
        onSaved(
          kr ? await updateKeyResult(kr.id, body) : await createKeyResult(objective.id, body),
        );
        onClose();
      },
      (error) => firstProblem(error, "Could not save the key result."),
    );
  }

  async function remove() {
    if (!kr) return;
    await run(
      async () => {
        await deleteKeyResult(kr.id);
        onDeleted();
        onClose();
      },
      (error) => firstProblem(error, "Could not delete the key result."),
    );
  }

  return (
    <Drawer
      open
      title={kr ? "Edit key result" : "New key result"}
      subtitle={objective.title}
      onClose={onClose}
    >
      <DrawerBody>
        <form id="kr-form" onSubmit={(event) => void save(event)} className="flex flex-col gap-4">
          <FormField label="Key result" hint="A number that shows the objective is reached.">
            <Input
              value={title}
              maxLength={300}
              required
              onChange={(event) => setTitle(event.target.value)}
              placeholder="For example: Online orders per month"
            />
          </FormField>
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Start value">
              <Input
                inputMode="decimal"
                value={start}
                onChange={(event) => setStart(event.target.value)}
                invalid={from === null}
              />
            </FormField>
            <FormField label="Target">
              <Input
                inputMode="decimal"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                invalid={target !== "" && (to === null || to === from)}
              />
            </FormField>
            <FormField label="Unit">
              <Input
                value={unit}
                maxLength={20}
                onChange={(event) => setUnit(event.target.value)}
                placeholder="%, $, orders"
              />
            </FormField>
          </div>
          <p className="m-0 text-xs text-muted">
            Progress is how far the value has gone from the start to the target. The target may be
            below the start (for example, cut returns from 10 to 2).
          </p>
          <div className="grid gap-1">
            <span className="text-sm font-medium">Owner</span>
            <UserPicker label="Owner" value={owner} onChange={setOwner} multiple={false} />
            <p className="m-0 text-xs text-muted">
              Left empty, the owner of the objective ({objective.owner.full_name}).
            </p>
          </div>
          {message && <Alert>{message}</Alert>}
        </form>
      </DrawerBody>
      <DrawerFooter>
        <Button type="submit" form="kr-form" variant="primary" icon={Save} loading={busy} disabled={!valid}>
          {kr ? "Save changes" : "Add key result"}
        </Button>
        <Button onClick={onClose}>Cancel</Button>
        {kr && (
          <span className="ml-auto">
            <InlineConfirm
              label="Delete"
              prompt="Delete this key result?"
              confirmLabel="Yes, delete"
              disabled={busy}
              onConfirm={() => void remove()}
            />
          </span>
        )}
      </DrawerFooter>
    </Drawer>
  );
}

// --- the weekly check-in -------------------------------------------------------------------------------

type CheckInProps = {
  objective: Objective;
  kr: KeyResult;
  /** False once the cycle is closed. */
  cycleOpen: boolean;
  onChanged: (objective: Objective) => void;
  onEdit: () => void;
  onClose: () => void;
};

/** The state of a key result, the weekly check-in form and the history of check-ins. */
export function CheckInDrawer({ objective, kr, cycleOpen, onChanged, onEdit, onClose }: CheckInProps) {
  const [value, setValue] = useState(String(kr.current_value));
  const [status, setStatus] = useState<KrStatus>(kr.status);
  const [note, setNote] = useState("");
  const { busy, message, run } = useAsyncAction();
  const history = useApiResource(
    (signal) => listCheckIns(kr.id, signal),
    "Could not load the history.",
    [kr.id, kr.updated_at],
  );
  const parsed = parse(value);
  const allowed = kr.can_check_in && cycleOpen;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (parsed === null) return;
    await run(
      async () => {
        const updated = await checkIn(kr.id, {
          value: parsed,
          status,
          ...(note.trim() ? { note: note.trim() } : {}),
        });
        setNote("");
        onChanged(updated);
      },
      (error) => firstProblem(error, "Could not save the check-in."),
    );
  }

  return (
    <Drawer open title={kr.title} subtitle={objective.title} onClose={onClose} wide>
      <DrawerBody>
        <section aria-label="State" className="grid gap-2">
          <ProgressBar value={kr.progress} label={`Progress of ${kr.title}`} />
          <p className="m-0 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span>
              <b>{formatValue(kr.current_value, kr.unit)}</b>
              <span className="text-muted"> now, from {formatValue(kr.start_value, kr.unit)} to </span>
              <b>{formatValue(kr.target_value, kr.unit)}</b>
            </span>
            <StatusPill status={kr.status} />
            <span className="text-muted">Owner: {kr.owner.full_name}</span>
          </p>
        </section>

        {allowed ? (
          <form onSubmit={(event) => void submit(event)} className="grid gap-3 rounded-lg border border-line p-3">
            <h3 className="m-0 text-sm">Check in</h3>
            <div className="grid grid-cols-2 gap-3">
              <FormField label={`New value${kr.unit ? ` (${kr.unit})` : ""}`}>
                <Input
                  inputMode="decimal"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  invalid={parsed === null}
                />
              </FormField>
              <FormField label="How is it going?">
                <Select value={status} onChange={(event) => setStatus(event.target.value as KrStatus)}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>
            <FormField label="Note (optional)">
              <Textarea
                rows={2}
                value={note}
                maxLength={5000}
                onChange={(event) => setNote(event.target.value)}
                placeholder="What moved, what is in the way, what you need"
              />
            </FormField>
            {message && <Alert>{message}</Alert>}
            <div>
              <Button type="submit" variant="primary" icon={Send} loading={busy} disabled={parsed === null}>
                Save check-in
              </Button>
            </div>
          </form>
        ) : (
          <p className="m-0 rounded-md bg-surface-muted px-3 py-2 text-sm text-muted">
            {cycleOpen
              ? "Only the owner of this key result, or of the objective, checks in."
              : "This cycle is closed."}
          </p>
        )}

        <section aria-label="History" className="grid gap-2">
          <h3 className="m-0 text-sm">History</h3>
          {history.kind === "loading" && <LoadingState>Loading…</LoadingState>}
          {history.kind === "error" && <Alert>{history.message}</Alert>}
          {history.kind === "ready" && history.data.length === 0 && (
            <p className="m-0 text-sm text-muted">No check-in yet.</p>
          )}
          {history.kind === "ready" && history.data.length > 0 && (
            <ol className="m-0 grid list-none gap-2 p-0">
              {history.data.map((entry) => (
                <li key={entry.id} className="rounded-md border border-line px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <b>{formatValue(entry.value, kr.unit)}</b>
                    <StatusPill status={entry.status} />
                    <span className="text-xs text-muted">
                      {entry.author.full_name} · {formatDateTime(entry.created_at)}
                    </span>
                  </div>
                  {entry.note && <p className="m-0 mt-1 whitespace-pre-wrap">{entry.note}</p>}
                </li>
              ))}
            </ol>
          )}
        </section>
      </DrawerBody>
      <DrawerFooter>
        {objective.can_edit && cycleOpen && (
          <Button icon={Pencil} onClick={onEdit}>
            Edit key result
          </Button>
        )}
        <Button onClick={onClose}>Close</Button>
      </DrawerFooter>
    </Drawer>
  );
}

// --- the review ------------------------------------------------------------------------------------------

type ReviewProps = {
  title: string;
  subtitle: string;
  score: number | null;
  merits: string | null;
  toImprove: string | null;
  /** Writes the review and answers with the objective as it is now. */
  save: (input: ReviewInput) => Promise<Objective>;
  onSaved: (objective: Objective) => void;
  onClose: () => void;
};

/** The review of an objective or a key result: a score from 0 to 1, what went well, what to improve. */
export function ReviewDrawer({ title, subtitle, score, merits, toImprove, save, onSaved, onClose }: ReviewProps) {
  const [scoreText, setScoreText] = useState(score === null ? "" : String(score));
  const [good, setGood] = useState(merits ?? "");
  const [better, setBetter] = useState(toImprove ?? "");
  const { busy, message, run } = useAsyncAction();
  const parsed = scoreText.trim() === "" ? null : parse(scoreText);
  const valid = scoreText.trim() === "" || (parsed !== null && parsed >= 0 && parsed <= 1);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid) return;
    await run(
      async () => {
        onSaved(await save({ score: parsed, merits: good.trim() || null, to_improve: better.trim() || null }));
        onClose();
      },
      (error) => firstProblem(error, "Could not save the review."),
    );
  }

  return (
    <Drawer open title={`Review: ${title}`} subtitle={subtitle} onClose={onClose}>
      <DrawerBody>
        <form id="review-form" onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
          <FormField label="Score (0 to 1)" hint="0.7 or more is a good result; 1 means everything was reached.">
            <Input
              inputMode="decimal"
              value={scoreText}
              onChange={(event) => setScoreText(event.target.value)}
              invalid={!valid}
              placeholder="0.8"
            />
          </FormField>
          <FormField label="Review: merits">
            <Textarea rows={4} value={good} maxLength={5000} onChange={(event) => setGood(event.target.value)} />
          </FormField>
          <FormField label="Review: to improve">
            <Textarea rows={4} value={better} maxLength={5000} onChange={(event) => setBetter(event.target.value)} />
          </FormField>
          {message && <Alert>{message}</Alert>}
        </form>
      </DrawerBody>
      <DrawerFooter>
        <Button type="submit" form="review-form" variant="primary" icon={Save} loading={busy} disabled={!valid}>
          Save review
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </DrawerFooter>
    </Drawer>
  );
}
