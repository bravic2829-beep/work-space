"use client";

import { useState } from "react";

import { Alert, Button, Drawer, DrawerBody, FormField, Input, Textarea } from "@/components/ui";
import { firstProblem } from "@/lib/api/errors";
import { useAsyncAction } from "@/lib/useAsyncAction";

import { setScore } from "./api";
import type { Criterion, CriterionScore, PersonScore } from "./schema";

type Props = {
  person: PersonScore;
  criterion: Criterion;
  current: CriterionScore;
  period: string;
  onSaved: () => void;
  onClose: () => void;
};

/** Write the score (0 to 100) of one person for one criterion, with the reason for it. */
export function ScoreDrawer({ person, criterion, current, period, onSaved, onClose }: Props) {
  const [score, setScoreText] = useState(current.score === null ? "" : String(Math.round(current.score)));
  const [reason, setReason] = useState(current.reason ?? "");
  const { busy, message, run } = useAsyncAction();
  const valid = /^\d{1,3}$/.test(score) && Number(score) <= 100 && reason.trim() !== "";

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!valid) return;
    await run(
      async () => {
        await setScore({
          criterion_id: criterion.id,
          user_id: person.user_id,
          period,
          score: Number(score),
          reason: reason.trim(),
        });
        onSaved();
      },
      (error) => firstProblem(error, "Could not save the score."),
    );
  }

  return (
    <Drawer
      open
      title={criterion.name}
      subtitle={`${person.full_name} · ${period} · weight ${criterion.weight}%`}
      onClose={onClose}
    >
      <DrawerBody>
        {criterion.description && <p className="m-0 text-sm text-muted">{criterion.description}</p>}
        <form onSubmit={(event) => void save(event)} className="grid gap-3">
          <FormField label="Score (0 to 100)">
            <Input
              inputMode="numeric"
              value={score}
              invalid={score !== "" && !(/^\d{1,3}$/.test(score) && Number(score) <= 100)}
              onChange={(event) => setScoreText(event.target.value)}
            />
          </FormField>
          <FormField label="Reason">
            <Textarea
              rows={4}
              value={reason}
              maxLength={2000}
              onChange={(event) => setReason(event.target.value)}
              placeholder="What this score is based on"
            />
          </FormField>
          {message && <Alert>{message}</Alert>}
          <div>
            <Button type="submit" variant="primary" loading={busy} disabled={!valid}>
              Save score
            </Button>
          </div>
        </form>
      </DrawerBody>
    </Drawer>
  );
}
