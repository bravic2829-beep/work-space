import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ColorPicker } from "./ColorPicker";

function setup(current = "#3e63dd") {
  const onPick = vi.fn();
  const onCancel = vi.fn();
  render(<ColorPicker current={current} label="High" onPick={onPick} onCancel={onCancel} />);
  return { onPick, onCancel, user: userEvent.setup() };
}

async function openCustom(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("tab", { name: "Custom" }));
}

describe("the color dialog", () => {
  it("starts on the Standard tab with the palette", () => {
    setup();
    expect(screen.getByRole("tab", { name: "Standard" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("button", { name: /#[0-9a-f]{6}$/ })).toHaveLength(12);
    expect(screen.getByRole("button", { name: "Blue #3e63dd" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("OK gives the color picked from the palette", async () => {
    const { onPick, user } = setup();
    await user.click(screen.getByRole("button", { name: "Pink #d6409f" }));
    await user.click(screen.getByRole("button", { name: "OK" }));
    expect(onPick).toHaveBeenCalledWith("#d6409f");
  });

  it("Cancel gives nothing", async () => {
    const { onPick, onCancel, user } = setup();
    await user.click(screen.getByRole("button", { name: "Pink #d6409f" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    expect(onPick).not.toHaveBeenCalled();
  });

  it("shows the new color beside the current one", async () => {
    const { user } = setup("#46a758");
    await user.click(screen.getByRole("button", { name: "Red #e5484d" }));
    expect(screen.getByLabelText("New color #e5484d")).toHaveStyle({ backgroundColor: "#e5484d" });
    expect(screen.getByLabelText("Current color #46a758")).toHaveStyle({
      backgroundColor: "#46a758",
    });
  });

  it("the Custom tab shows RGB and hex for the current color", async () => {
    const { user } = setup("#3e63dd");
    await openCustom(user);
    expect(screen.getByLabelText("Red")).toHaveValue(62);
    expect(screen.getByLabelText("Green")).toHaveValue(99);
    expect(screen.getByLabelText("Blue")).toHaveValue(221);
    expect(screen.getByLabelText("Hex")).toHaveValue("#3e63dd");
  });

  it("typing a hex makes the new color", async () => {
    const { onPick, user } = setup();
    await openCustom(user);
    const hex = screen.getByLabelText("Hex");
    await user.clear(hex);
    await user.type(hex, "#ff8800");
    expect(screen.getByLabelText("Red")).toHaveValue(255);
    expect(screen.getByLabelText("Green")).toHaveValue(136);
    expect(screen.getByLabelText("Blue")).toHaveValue(0);
    await user.click(screen.getByRole("button", { name: "OK" }));
    expect(onPick).toHaveBeenCalledWith("#ff8800");
  });

  it("an unfinished hex changes nothing until it is complete", async () => {
    const { onPick, user } = setup("#3e63dd");
    await openCustom(user);
    const hex = screen.getByLabelText("Hex");
    await user.clear(hex);
    await user.type(hex, "#ff88");
    expect(screen.getByLabelText("New color #3e63dd")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "OK" }));
    expect(onPick).toHaveBeenCalledWith("#3e63dd");
  });

  it("changing a channel updates the hex", async () => {
    const { onPick, user } = setup("#000000");
    await openCustom(user);
    const red = screen.getByLabelText("Red");
    await user.clear(red);
    await user.type(red, "255");
    expect(screen.getByLabelText("Hex")).toHaveValue("#ff0000");
    await user.click(screen.getByRole("button", { name: "OK" }));
    expect(onPick).toHaveBeenCalledWith("#ff0000");
  });

  it("keeps a channel between 0 and 255", async () => {
    const { user } = setup("#000000");
    await openCustom(user);
    const blue = screen.getByLabelText("Blue");
    await user.clear(blue);
    await user.type(blue, "999");
    expect(blue).toHaveValue(255);
  });

  it("says which text color goes on the new color", async () => {
    const { user } = setup("#000000");
    expect(screen.getByText(/White text/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Yellow #e5c100" }));
    expect(screen.getByText(/Black text/)).toBeInTheDocument();
  });

  it("is named for the option it colors", () => {
    setup();
    expect(screen.getByRole("group", { name: "Color of High" })).toBeInTheDocument();
  });
});
