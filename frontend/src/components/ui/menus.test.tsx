import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button } from "./Button";
import { Menu } from "./Menu";
import { SkeletonTable } from "./Skeleton";
import { SplitButton } from "./SplitButton";
import { ToastProvider, useToast } from "./Toast";

describe("Menu", () => {
  it("runs the chosen item and closes", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Menu trigger={<Button>More</Button>} items={[{ label: "Rename", onSelect }]} />);
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });
});

describe("SplitButton", () => {
  it("does the main action with the button and the others from the arrow", async () => {
    const user = userEvent.setup();
    const main = vi.fn();
    const other = vi.fn();
    render(
      <SplitButton
        label="Assign task"
        onClick={main}
        moreLabel="More ways to add"
        items={[{ label: "New record", onSelect: other }]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Assign task" }));
    expect(main).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "More ways to add" }));
    await user.click(screen.getByRole("menuitem", { name: "New record" }));
    expect(other).toHaveBeenCalledTimes(1);
    expect(main).toHaveBeenCalledTimes(1);
  });
});

function Shout({ onView }: { onView: () => void }) {
  const toast = useToast();
  return (
    <Button onClick={() => toast("Assigned it.", { action: { label: "View", onClick: onView } })}>
      Go
    </Button>
  );
}

describe("Toast", () => {
  it("shows a message with an action, and takes it away when dismissed", async () => {
    const user = userEvent.setup();
    const onView = vi.fn();
    render(
      <ToastProvider>
        <Shout onView={onView} />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Go" }));
    expect(screen.getByText("Assigned it.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "View" }));
    expect(onView).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Assigned it.")).not.toBeInTheDocument();
  });

  it("does nothing outside a provider", async () => {
    const user = userEvent.setup();
    render(<Shout onView={() => undefined} />);
    await user.click(screen.getByRole("button", { name: "Go" }));
    expect(screen.queryByText("Assigned it.")).not.toBeInTheDocument();
  });
});

describe("SkeletonTable", () => {
  it("keeps the headings and tells screen readers it is loading", () => {
    render(<SkeletonTable headings={["Name", "Status"]} label="Loading records…" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading records…");
    expect(screen.getByText("Name")).toBeInTheDocument();
  });
});
