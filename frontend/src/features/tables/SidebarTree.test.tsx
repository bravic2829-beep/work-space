import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listSheets } from "@/features/sheets/api";
import type { SheetItem } from "@/features/sheets/schema";

import { listBases, listTables, listWorkspaces } from "./api";
import { SidebarTree } from "./SidebarTree";

vi.mock("next/navigation", () => ({ usePathname: () => "/tables/t-1" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("./api", () => ({ listWorkspaces: vi.fn(), listBases: vi.fn(), listTables: vi.fn() }));
vi.mock("@/features/sheets/api", () => ({ listSheets: vi.fn() }));

const workspace = { id: "w-1", name: "Operations", kind: "shared", my_role: "editor" } as never;

function sheet(tableId: string, name: string, canSeeAll: boolean): SheetItem {
  return {
    id: `s-${tableId}`,
    table_id: tableId,
    table_name: name,
    owner: { id: "u", full_name: "U", employee_code: "U1" },
    name: "U",
    my_role: "editor",
    is_admin: false,
    can_see_all: canSeeAll,
    member_count: 1,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listWorkspaces).mockResolvedValue([]);
  vi.mocked(listSheets).mockResolvedValue([]);
});
afterEach(cleanup);

describe("SidebarTree", () => {
  it("lists the tables of a workspace only once it is opened", async () => {
    vi.mocked(listWorkspaces).mockResolvedValue([workspace]);
    vi.mocked(listBases).mockResolvedValue([{ id: "b-1", workspace_id: "w-1", name: "Sales" }]);
    vi.mocked(listTables).mockResolvedValue([{ id: "t-1", name: "Tasks" } as never]);
    render(<SidebarTree />);

    await screen.findByRole("link", { name: "Operations" });
    expect(listBases).not.toHaveBeenCalled();

    await userEvent.setup().click(screen.getByRole("button", { name: /Show the tables of Operations/ }));
    const link = await screen.findByRole("link", { name: "Tasks" });
    expect(link).toHaveAttribute("href", "/tables/t-1");
    expect(link).toHaveAttribute("aria-current", "page");
  });

  it("shows tables reached only through a sheet under Shared with me", async () => {
    vi.mocked(listSheets).mockResolvedValue([
      sheet("t-7", "Projects", false),
      sheet("t-8", "Own workspace table", true),
    ]);
    render(<SidebarTree />);

    expect(await screen.findByRole("link", { name: "Projects" })).toHaveAttribute("href", "/tables/t-7");
    expect(screen.queryByRole("link", { name: "Own workspace table" })).not.toBeInTheDocument();
  });

  it("shows nothing when there is nothing to list, and stays quiet when the lists fail", async () => {
    vi.mocked(listWorkspaces).mockRejectedValue(new Error("down"));
    vi.mocked(listSheets).mockRejectedValue(new Error("down"));
    const { container } = render(<SidebarTree />);
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
  });
});
