import { render, screen } from "@testing-library/react";
import { Home, ListChecks } from "lucide-react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NavLink } from "./NavLink";

const path = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => path.current }));
vi.mock("next/link", () => ({
  default: (props: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a {...props} />
  ),
}));

beforeEach(() => {
  path.current = "/";
});

describe("NavLink", () => {
  it("marks the page you are on", () => {
    path.current = "/my-tasks";
    render(
      <>
        <NavLink href="/" icon={Home}>
          Home
        </NavLink>
        <NavLink href="/my-tasks" icon={ListChecks}>
          My tasks
        </NavLink>
      </>,
    );
    expect(screen.getByRole("link", { name: "My tasks" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it("keeps the section marked on a page below it", () => {
    path.current = "/workspaces/abc";
    render(
      <NavLink href="/workspaces" icon={Home}>
        Workspaces
      </NavLink>,
    );
    expect(screen.getByRole("link", { name: "Workspaces" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("does not mark Home on every page, and does not confuse similar names", () => {
    path.current = "/workspaces-archive";
    render(
      <>
        <NavLink href="/" icon={Home}>
          Home
        </NavLink>
        <NavLink href="/workspaces" icon={Home}>
          Workspaces
        </NavLink>
      </>,
    );
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Workspaces" })).not.toHaveAttribute("aria-current");
  });

  it("marks Home on the home page", () => {
    render(
      <NavLink href="/" icon={Home}>
        Home
      </NavLink>,
    );
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  });
});
