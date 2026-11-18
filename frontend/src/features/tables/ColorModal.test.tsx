import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ColorModal } from "./ColorModal";

function setup() {
  const onPick = vi.fn();
  const onCancel = vi.fn();
  const behind = vi.fn();
  document.addEventListener("keydown", behind);
  render(<ColorModal label="High" current="#3e63dd" onPick={onPick} onCancel={onCancel} />);
  return { onPick, onCancel, behind, user: userEvent.setup() };
}

describe("the color window", () => {
  it("is a modal window titled Colors, drawn on the page itself", () => {
    setup();
    const dialog = screen.getByRole("dialog", { name: "Colors for High" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(screen.getByRole("heading", { name: "Colors" })).toBeInTheDocument();
  });

  it("gives the color on OK", async () => {
    const { onPick, user } = setup();
    await user.click(screen.getByRole("button", { name: "Pink #d6409f" }));
    await user.click(screen.getByRole("button", { name: "OK" }));
    expect(onPick).toHaveBeenCalledWith("#d6409f");
  });

  it("cancels on the close button and on a click outside the window", async () => {
    const { onCancel, user } = setup();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("does not cancel when the click is inside the window", async () => {
    const { onCancel, user } = setup();
    await user.click(screen.getByRole("heading", { name: "Colors" }));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels on Escape, and the panel behind never sees the key", async () => {
    const { onCancel, behind, user } = setup();
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalled();
    expect(behind).not.toHaveBeenCalled();
  });
});
