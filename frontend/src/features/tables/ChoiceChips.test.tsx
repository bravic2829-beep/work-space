import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChoiceChips } from "./ChoiceChips";

const OPTIONS = [
  { id: "a", name: "High" },
  { id: "b", name: "Low" },
];

describe("ChoiceChips clear button", () => {
  it("shows a round X once a single choice is picked, and empties it", async () => {
    const onChange = vi.fn();
    render(
      <ChoiceChips label="Priority" options={OPTIONS} value={["a"]} onChange={onChange} multiple={false} />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Clear choice" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("does the same for several choices, clearing them all at once", async () => {
    const onChange = vi.fn();
    render(
      <ChoiceChips label="Tags" options={OPTIONS} value={["a", "b"]} onChange={onChange} multiple />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Clear all choices" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("is not there when nothing is picked or the field is read-only", () => {
    const { rerender } = render(
      <ChoiceChips label="Priority" options={OPTIONS} value={[]} onChange={vi.fn()} multiple={false} />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    rerender(
      <ChoiceChips label="Priority" options={OPTIONS} value={["a"]} onChange={vi.fn()} multiple={false} disabled />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
