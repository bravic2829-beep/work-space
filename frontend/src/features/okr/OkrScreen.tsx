"use client";

import {
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  ListChecks,
  Plus,
  Target,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { useState } from "react";

import {
  Alert,
  Badge,
  Button,
  Checkbox,
  EmptyState,
  LoadingState,
  PageHeader,
  Select,
  StatCard,
  Tabs,
  type TabItem,
} from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { isOrgAdmin } from "@/features/auth/schema";
import { useApiResource } from "@/lib/useApiResource";

import { AlignmentTree } from "./AlignmentTree";
import { getOverview, listCycles, listOkrDepartments, reviewKeyResult, reviewObjective } from "./api";
import { CycleDrawer } from "./CycleDrawer";
import { CheckInDrawer, KeyResultDrawer, ReviewDrawer } from "./KeyResultDrawers";
import { ObjectiveDrawer } from "./ObjectiveDrawer";
import { OkrTable } from "./OkrTable";
import { percent, LEVEL_LABELS, LEVELS, type Objective, type OkrLevel } from "./schema";

type Tab = "summary" | "risk" | "review" | "alignment";

const TABS: TabItem<Tab>[] = [
  { id: "summary", label: "OKR Summary" },
  { id: "risk", label: "Risky KRs" },
  { id: "review", label: "Review" },
  { id: "alignment", label: "Alignment" },
];

const EMPTY: Record<Tab, string> = {
  summary: "Make an objective with “New objective”, then add its key results.",
  risk: "No key result is at risk or off track. They show here as soon as an owner says so in a check-in.",
  review: "Nothing to review in this cycle yet.",
  alignment: "",
};

type Panel =
  | { kind: "objective"; objectiveId: string | null }
  | { kind: "key-result"; objectiveId: string; krId: string | null }
  | { kind: "check-in"; objectiveId: string; krId: string }
  | { kind: "review-objective"; objectiveId: string }
  | { kind: "review-key-result"; objectiveId: string; krId: string }
  | { kind: "cycles" };

/**
 * OKR: the objectives of a cycle (a quarter, a year) with the key results that measure them. Four
 * views of the same data, like the tabs of the design: the summary grouped by objective, the key
 * results at risk, the review (score and notes), and how the objectives support each other.
 */
export function OkrScreen() {
  const { state: auth } = useAuth();
  const admin = auth.status === "authenticated" && isOrgAdmin(auth.user);
  const [cyclesKey, setCyclesKey] = useState(0);
  const cycles = useApiResource(listCycles, "Could not load the cycles.", [cyclesKey]);
  const departments = useApiResource(listOkrDepartments, "Could not load the departments.", []);
  const [cycleId, setCycleId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("summary");
  const [mine, setMine] = useState(false);
  const [level, setLevel] = useState<OkrLevel | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [panel, setPanel] = useState<Panel | null>(null);

  const list = cycles.kind === "ready" ? cycles.data : [];
  const cycle =
    list.find((c) => c.id === cycleId) ?? list.find((c) => c.status === "open") ?? list[0] ?? null;
  const risky = tab === "risk";

  const overview = useApiResource(
    (signal) =>
      cycle
        ? getOverview(
            { cycleId: cycle.id, krStatus: risky ? ["at_risk", "off_track"] : undefined, level, mine },
            signal,
          )
        : Promise.resolve(null),
    "Could not load the OKRs.",
    [cycle?.id, risky, level, mine, refresh],
  );
  // The alignment and the "supports" choice need every objective, whatever the view filters.
  const everything = useApiResource(
    (signal) => (cycle ? getOverview({ cycleId: cycle.id }, signal) : Promise.resolve(null)),
    "Could not load the OKRs.",
    [cycle?.id, refresh],
  );

  const objectives = overview.kind === "ready" && overview.data ? overview.data.objectives : [];
  const all = everything.kind === "ready" && everything.data ? everything.data.objectives : [];
  const cycleOpen = cycle?.status === "open";
  const again = () => setRefresh((n) => n + 1);
  const close = () => setPanel(null);

  // What a panel is about, from the newest data: a check-in changes the key result under it.
  const objectiveOf = (id: string): Objective | undefined =>
    all.find((o) => o.id === id) ?? objectives.find((o) => o.id === id);
  const found = (() => {
    if (!panel || panel.kind === "cycles") return null;
    const objective = panel.objectiveId ? objectiveOf(panel.objectiveId) : undefined;
    return objective ?? null;
  })();

  function renderPanel() {
    if (!panel) return null;
    if (panel.kind === "cycles") {
      return (
        <CycleDrawer
          cycles={list}
          onChanged={(created) => {
            setCyclesKey((n) => n + 1);
            if (created) setCycleId(created.id);
          }}
          onClose={close}
        />
      );
    }
    if (!cycle) return null;
    if (panel.kind === "objective") {
      if (panel.objectiveId !== null && !found) return null;
      return (
        <ObjectiveDrawer
          cycle={cycle}
          objective={found}
          objectives={all}
          departments={departments.kind === "ready" ? departments.data : []}
          isAdmin={admin}
          onSaved={again}
          onDeleted={again}
          onClose={close}
        />
      );
    }
    if (!found) return null;
    if (panel.kind === "key-result") {
      const kr = panel.krId ? found.key_results.find((k) => k.id === panel.krId) ?? null : null;
      if (panel.krId && !kr) return null;
      return <KeyResultDrawer objective={found} kr={kr} onSaved={again} onDeleted={again} onClose={close} />;
    }
    if (panel.kind === "check-in") {
      const kr = found.key_results.find((k) => k.id === panel.krId);
      if (!kr) return null;
      return (
        <CheckInDrawer
          objective={found}
          kr={kr}
          cycleOpen={cycleOpen}
          onChanged={again}
          onEdit={() => setPanel({ kind: "key-result", objectiveId: found.id, krId: kr.id })}
          onClose={close}
        />
      );
    }
    if (panel.kind === "review-objective") {
      return (
        <ReviewDrawer
          title={found.title}
          subtitle="Objective"
          score={found.score}
          merits={found.merits}
          toImprove={found.to_improve}
          save={(input) => reviewObjective(found.id, input)}
          onSaved={again}
          onClose={close}
        />
      );
    }
    const kr = found.key_results.find((k) => k.id === panel.krId);
    if (!kr) return null;
    return (
      <ReviewDrawer
        title={kr.title}
        subtitle={found.title}
        score={kr.score}
        merits={kr.merits}
        toImprove={kr.to_improve}
        save={(input) => reviewKeyResult(kr.id, input)}
        onSaved={again}
        onClose={close}
      />
    );
  }

  const summary = overview.kind === "ready" && overview.data ? overview.data.summary : null;

  return (
    <>
      <PageHeader
        title="OKR"
        description="Objectives and key results: where we want to go, and how we measure that we got there."
      />
      {cycles.kind === "loading" && <LoadingState>Loading…</LoadingState>}
      {cycles.kind === "error" && <Alert>{cycles.message}</Alert>}
      {cycles.kind === "ready" && !cycle && (
        <EmptyState icon={CalendarRange} title="No OKR cycle yet.">
          {admin ? (
            <Button variant="primary" icon={Plus} onClick={() => setPanel({ kind: "cycles" })}>
              Open the first cycle
            </Button>
          ) : (
            "An admin opens a cycle (a quarter or a year) before objectives can be made."
          )}
        </EmptyState>
      )}
      {cycle && (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-[13px] font-medium">
                Cycle
                <Select
                  className="h-8 w-auto py-0 text-[13px]"
                  value={cycle.id}
                  onChange={(event) => setCycleId(event.target.value)}
                >
                  {list.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </label>
              <Badge tone={cycleOpen ? "success" : "neutral"}>{cycleOpen ? "Open" : "Closed"}</Badge>
              <span className="text-xs text-muted">
                {cycle.starts_on} to {cycle.ends_on}
              </span>
              <Select
                aria-label="Filter by level"
                className="h-8 w-auto py-0 text-[13px]"
                value={level ?? ""}
                onChange={(event) => setLevel((event.target.value || null) as OkrLevel | null)}
              >
                <option value="">All levels</option>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {LEVEL_LABELS[l]}
                  </option>
                ))}
              </Select>
              <Checkbox
                label="Only mine"
                className="text-[13px]"
                checked={mine}
                onChange={(event) => setMine(event.target.checked)}
              />
            </div>
            <div className="flex items-center gap-2">
              {admin && (
                <Button size="sm" icon={CalendarRange} onClick={() => setPanel({ kind: "cycles" })}>
                  Cycles
                </Button>
              )}
              {cycleOpen && (
                <Button
                  size="sm"
                  variant="primary"
                  icon={Plus}
                  onClick={() => setPanel({ kind: "objective", objectiveId: null })}
                >
                  New objective
                </Button>
              )}
            </div>
          </div>

          {!cycleOpen && (
            <Alert>This cycle is closed. Nothing can be changed, but the review can still be written.</Alert>
          )}

          {summary && (
            <ul aria-label="Totals" className="m-0 grid list-none grid-cols-2 gap-3 p-0 md:grid-cols-3 xl:grid-cols-6">
              <StatCard label="Objectives" value={summary.objectives} icon={Target} tone="info" />
              <StatCard label="Key results" value={summary.key_results} icon={ListChecks} />
              <StatCard
                label="Average progress"
                value={summary.progress === null ? null : percent(summary.progress)}
                icon={TrendingUp}
                tone="info"
                unavailableHint="No objective has a key result yet"
              />
              <StatCard label="On track" value={summary.on_track} icon={CheckCircle2} tone="success" />
              <StatCard label="At risk" value={summary.at_risk} icon={AlertTriangle} tone="warning" />
              <StatCard label="Off track" value={summary.off_track} icon={XCircle} tone="danger" />
            </ul>
          )}

          <Tabs label="OKR views" idPrefix="okr" tabs={TABS} value={tab} onChange={setTab} />
          <div role="tabpanel" id={`okr-panel-${tab}`} aria-labelledby={`okr-tab-${tab}`}>
            {overview.kind === "loading" && <LoadingState>Loading the OKRs…</LoadingState>}
            {overview.kind === "error" && <Alert>{overview.message}</Alert>}
            {overview.kind === "ready" &&
              (tab === "alignment" ? (
                <AlignmentTree
                  objectives={all}
                  onOpen={(o) => setPanel({ kind: "objective", objectiveId: o.id })}
                />
              ) : (
                <OkrTable
                  objectives={objectives}
                  mode={tab === "review" ? "review" : "summary"}
                  cycleOpen={cycleOpen}
                  emptyText={EMPTY[tab]}
                  onOpenKr={(kr, o) => setPanel({ kind: "check-in", objectiveId: o.id, krId: kr.id })}
                  onAddKr={(o) => setPanel({ kind: "key-result", objectiveId: o.id, krId: null })}
                  onEditObjective={(o) => setPanel({ kind: "objective", objectiveId: o.id })}
                  onReviewObjective={(o) => setPanel({ kind: "review-objective", objectiveId: o.id })}
                  onReviewKr={(kr, o) =>
                    setPanel({ kind: "review-key-result", objectiveId: o.id, krId: kr.id })
                  }
                />
              ))}
          </div>
        </div>
      )}
      {renderPanel()}
    </>
  );
}
