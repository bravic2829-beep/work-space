"use client";

import { Network } from "lucide-react";

import { Avatar, Badge, EmptyState, plainName } from "@/components/ui";

import { ProgressBar } from "./Progress";
import { LEVEL_LABELS, type Objective } from "./schema";

type Props = {
  objectives: Objective[];
  /** Open an objective the person may edit. */
  onOpen: (objective: Objective) => void;
};

type Node = { objective: Objective; children: Node[] };

/** The objectives as a tree: each one under the objective it supports, the company's on top. */
export function buildTree(objectives: Objective[]): Node[] {
  const nodes = new Map<string, Node>(objectives.map((o) => [o.id, { objective: o, children: [] }]));
  const roots: Node[] = [];
  for (const node of nodes.values()) {
    const parent = node.objective.parent_id ? nodes.get(node.objective.parent_id) : undefined;
    // An objective whose parent is not in the list (filtered, or private) is a root here.
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function Branch({ node, onOpen }: { node: Node; onOpen: Props["onOpen"] }) {
  const { objective } = node;
  const title = <span className="truncate font-medium">{objective.title}</span>;
  return (
    <li>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-line bg-surface px-3 py-2">
        {objective.can_edit ? (
          <button
            type="button"
            className="h-auto min-w-0 max-w-96 justify-start border-0 bg-transparent p-0 text-primary hover:bg-transparent hover:underline"
            aria-label={`Open ${objective.title}`}
            onClick={() => onOpen(objective)}
          >
            {title}
          </button>
        ) : (
          title
        )}
        <Badge tone="info">{objective.department?.name ?? LEVEL_LABELS[objective.level]}</Badge>
        <span className="inline-flex items-center gap-1.5 text-sm">
          <Avatar name={objective.owner.full_name} className="size-5 text-[10px]" />
          {plainName(objective.owner.full_name)}
        </span>
        <span className="ml-auto w-48">
          <ProgressBar value={objective.progress} label={`Progress of ${objective.title}`} />
        </span>
      </div>
      {node.children.length > 0 && (
        <ul className="m-0 mt-2 grid list-none gap-2 border-l-2 border-line pl-5">
          {node.children.map((child) => (
            <Branch key={child.objective.id} node={child} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Alignment: how the objectives of people and teams support the objectives above them. */
export function AlignmentTree({ objectives, onOpen }: Props) {
  if (objectives.length === 0) {
    return (
      <EmptyState icon={Network} title="No objective yet.">
        Make the first objective of the cycle, then link the others to it with “Supports”.
      </EmptyState>
    );
  }
  return (
    <ul aria-label="Alignment" className="m-0 grid list-none gap-2 p-0">
      {buildTree(objectives).map((node) => (
        <Branch key={node.objective.id} node={node} onOpen={onOpen} />
      ))}
    </ul>
  );
}
