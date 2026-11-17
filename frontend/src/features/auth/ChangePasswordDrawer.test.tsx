import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import { changePassword } from "./api";
import { ChangePasswordDrawer } from "./ChangePasswordDrawer";

vi.mock("./api", () => ({ changePassword: vi.fn() }));

const changeMock = vi.mocked(changePassword);

beforeEach(() => {
  vi.resetAllMocks();
});

async function fill(current: string, next: string, confirm: string) {
  const form = screen.getByRole("form", { name: "Change password" });
  await userEvent.type(
    within(form).getByLabelText("Current password"),
    current,
  );
  await userEvent.type(within(form).getByLabelText("New password"), next);
  await userEvent.type(
    within(form).getByLabelText("Confirm new password"),
    confirm,
  );
  await userEvent.click(
    within(form).getByRole("button", { name: "Change password" }),
  );
  return form;
}

describe("ChangePasswordDrawer", () => {
  it("sends the current and the new password, then empties the fields", async () => {
    changeMock.mockResolvedValue(undefined);
    render(<ChangePasswordDrawer open onClose={() => {}} />);

    const form = await fill("Old-Pass-1", "Brand-New-2", "Brand-New-2");

    await waitFor(() =>
      expect(changeMock).toHaveBeenCalledWith("Old-Pass-1", "Brand-New-2"),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Your password was changed.",
    );
    expect(within(form).getByLabelText("Current password")).toHaveValue("");
    expect(within(form).getByLabelText("New password")).toHaveValue("");
  });

  it("does not send anything when the two new passwords differ", async () => {
    render(<ChangePasswordDrawer open onClose={() => {}} />);

    await fill("Old-Pass-1", "Brand-New-2", "Brand-New-3");

    expect(await screen.findByRole("alert")).toHaveTextContent("do not match");
    expect(changeMock).not.toHaveBeenCalled();
  });

  it("shows why it failed and keeps what was typed", async () => {
    changeMock.mockRejectedValue(
      new ApiError("The current password is not correct.", 403),
    );
    render(<ChangePasswordDrawer open onClose={() => {}} />);

    const form = await fill("wrong-pass", "Brand-New-2", "Brand-New-2");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "current password is not correct",
    );
    expect(within(form).getByLabelText("New password")).toHaveValue(
      "Brand-New-2",
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("Cancel closes it", async () => {
    const onClose = vi.fn();
    render(<ChangePasswordDrawer open onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});
