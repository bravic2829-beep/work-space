import type { Department } from "./schema";

export type DepartmentRow = { item: Department; depth: 0 | 1 };

function byName(a: Department, b: Department): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/**
 * Puts the flat list in reading order: each division, then the departments under it (indented),
 * then the departments that belong to no division. Same data, just arranged like the org chart.
 */
export function orderDepartments(departments: Department[]): DepartmentRow[] {
  const divisionIds = new Set(departments.filter((d) => d.kind === "division").map((d) => d.id));
  const rows: DepartmentRow[] = [];

  for (const division of departments.filter((d) => d.kind === "division").sort(byName)) {
    rows.push({ item: division, depth: 0 });
    for (const child of departments.filter((d) => d.parent_id === division.id).sort(byName)) {
      rows.push({ item: child, depth: 1 });
    }
  }

  const standalone = departments.filter(
    (d) => d.kind !== "division" && (d.parent_id === null || !divisionIds.has(d.parent_id)),
  );
  for (const item of standalone.sort(byName)) rows.push({ item, depth: 0 });

  return rows;
}

/** A department's own name, and the name of the division it sits under (null for a top-level one). */
export function departmentParts(
  department: Department,
  all: Department[],
): { name: string; parentName: string | null } {
  const parent = all.find((d) => d.id === department.parent_id);
  return { name: department.name, parentName: parent?.name ?? null };
}

/** "Sales / Team A" for a department under a division, so a long list of teams stays readable. */
export function departmentLabel(department: Department, all: Department[]): string {
  const parent = all.find((d) => d.id === department.parent_id);
  return parent ? `${parent.name} / ${department.name}` : department.name;
}
