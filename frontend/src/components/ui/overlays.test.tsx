import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui";

function Demo() {
  return (
    <>
      <Popover>
        <Tooltip>
          <TooltipTrigger render={<PopoverTrigger render={<Button>Open</Button>} />} />
          <TooltipContent>Show or hide</TooltipContent>
        </Tooltip>
        <PopoverContent>Inside</PopoverContent>
      </Popover>
      <button type="button">Elsewhere</button>
    </>
  );
}

describe("Tooltip", () => {
  it("shows on hover and hides when the pointer leaves", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    await user.hover(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Show or hide");
    expect(screen.getByRole("button", { name: "Open" })).toHaveAccessibleDescription("Show or hide");
    await user.unhover(screen.getByRole("button", { name: "Open" }));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});

describe("Popover", () => {
  it("opens on click, hides the tooltip, and closes on Escape or an outside click", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    const trigger = screen.getByRole("button", { name: "Open" });
    await user.click(trigger);
    expect(screen.getByRole("dialog")).toHaveTextContent("Inside");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
