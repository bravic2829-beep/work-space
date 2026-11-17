import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components/ui";
import { ApiError } from "@/lib/api/client";

import { deleteForever, listTrash, restoreRecord } from "./api";
import { isTrashItem, isTrashPage } from "./schema";
import type { TrashItem } from "./schema";
import { TrashScreen } from "./TrashScreen";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("./api", () => ({
  listTrash: vi.fn(),
  restoreRecord: vi.fn(),
  deleteForever: vi.fn(),
}));

const deleteMock = vi.mocked(deleteForever);
const listMock = vi.mocked(listTrash);
const restoreMock = vi.mocked(restoreRecord);

function item(id: string, name: string | null, overrides: Partial<TrashItem> = {}): TrashItem {
  return {
    id,
    table_id: "t-1",
    table_name: "Tasks",
    name,
    deleted_at: "2026-11-01T10:00:00Z",
    purge_at: "2026-12-01T10:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("trash shapes", () => {
  it("accepts a valid page and rejects wrong shapes", () => {
    expect(isTrashItem(item("r-1", "Launch"))).toBe(true);
    expect(isTrashItem(item("r-1", null))).toBe(true);
    expect(isTrashPage({ items: [item("r-1", "x")], next_cursor: null })).toBe(true);
    expect(isTrashItem({ ...item("r-1", "x"), purge_at: 3 })).toBe(false);
    expect(isTrashItem({ ...item("r-1", "x"), table_name: undefined })).toBe(false);
    expect(isTrashItem(null)).toBe(false);
    expect(isTrashPage({ items: [{}], next_cursor: null })).toBe(false);
    expect(isTrashPage({ items: [], next_cursor: 1 })).toBe(false);
  });
});

describe("TrashScreen", () => {
  it("lists what I deleted, with the table and the dates", async () => {
    listMock.mockResolvedValue({
      items: [item("r-1", "Launch")],
      next_cursor: null,
    });
    render(
      <ToastProvider>
        <TrashScreen />
      </ToastProvider>,
    );
    expect(await screen.findByText("Launch")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tasks" })).toHaveAttribute("href", "/tables/t-1");
    expect(listMock).toHaveBeenCalledWith(null, expect.any(AbortSignal));
  });

  it("restores a record and takes it off the list", async () => {
    listMock.mockResolvedValue({
      items: [item("r-1", "Launch"), item("r-2", "Plan")],
      next_cursor: null,
    });
    restoreMock.mockResolvedValue(undefined);
    render(
      <ToastProvider>
        <TrashScreen />
      </ToastProvider>,
    );
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Restore Launch" }));

    expect(restoreMock).toHaveBeenCalledWith("r-1");
    expect(await screen.findByText('Restored "Launch" to Tasks.')).toBeInTheDocument();
    expect(screen.queryByText("Launch", { selector: "td" })).not.toBeInTheDocument();
    expect(screen.getByText("Plan")).toBeInTheDocument();
  });

  it("keeps the record on the list and shows why when restoring fails", async () => {
    listMock.mockResolvedValue({
      items: [item("r-1", "Launch")],
      next_cursor: null,
    });
    restoreMock.mockRejectedValue(new ApiError("The record is not in the trash.", 404));
    render(
      <ToastProvider>
        <TrashScreen />
      </ToastProvider>,
    );
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Restore Launch" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("not in the trash");
    expect(screen.getByText("Launch")).toBeInTheDocument();
  });

  it("asks first, then removes a record for good and takes it off the list", async () => {
    listMock.mockResolvedValue({
      items: [item("r-1", "Launch"), item("r-2", "Plan")],
      next_cursor: null,
    });
    deleteMock.mockResolvedValue(undefined);
    render(
      <ToastProvider>
        <TrashScreen />
      </ToastProvider>,
    );
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "Delete Launch forever" }),
    );
    expect(deleteMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Yes, delete" }));

    expect(deleteMock).toHaveBeenCalledWith("r-1");
    expect(
      await screen.findByText('Removed "Launch" for good.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Launch", { selector: "td" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Plan")).toBeInTheDocument();
  });

  it("does nothing when the question is cancelled", async () => {
    listMock.mockResolvedValue({
      items: [item("r-1", "Launch")],
      next_cursor: null,
    });
    render(
      <ToastProvider>
        <TrashScreen />
      </ToastProvider>,
    );
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "Delete Launch forever" }),
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(deleteMock).not.toHaveBeenCalled();
    expect(screen.getByText("Launch")).toBeInTheDocument();
  });

  it("keeps the record and shows why when removing fails", async () => {
    listMock.mockResolvedValue({
      items: [item("r-1", "Launch")],
      next_cursor: null,
    });
    deleteMock.mockRejectedValue(
      new ApiError("The record is not in the trash.", 404),
    );
    render(
      <ToastProvider>
        <TrashScreen />
      </ToastProvider>,
    );
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "Delete Launch forever" }),
    );
    await user.click(screen.getByRole("button", { name: "Yes, delete" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "not in the trash",
    );
    expect(screen.getByText("Launch")).toBeInTheDocument();
  });

  it("says so when the trash is empty", async () => {
    listMock.mockResolvedValue({ items: [], next_cursor: null });
    render(
      <ToastProvider>
        <TrashScreen />
      </ToastProvider>,
    );
    expect(await screen.findByText("The trash is empty.")).toBeInTheDocument();
  });

  it("shows a record whose name is hidden without leaking anything", async () => {
    listMock.mockResolvedValue({
      items: [item("r-1", null)],
      next_cursor: null,
    });
    render(
      <ToastProvider>
        <TrashScreen />
      </ToastProvider>,
    );
    expect(await screen.findByText("(name hidden)")).toBeInTheDocument();
  });

  it("loads the next page", async () => {
    listMock
      .mockResolvedValueOnce({
        items: [item("r-1", "Launch")],
        next_cursor: "next",
      })
      .mockResolvedValueOnce({
        items: [item("r-2", "Plan")],
        next_cursor: null,
      });
    render(
      <ToastProvider>
        <TrashScreen />
      </ToastProvider>,
    );
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Load more" }));

    expect(listMock).toHaveBeenLastCalledWith("next");
    expect(await screen.findByText("Plan")).toBeInTheDocument();
    expect(screen.getByText("Launch")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("shows an error when the trash cannot be loaded", async () => {
    listMock.mockRejectedValue(new ApiError("Authentication is required.", 401));
    render(
      <ToastProvider>
        <TrashScreen />
      </ToastProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Authentication is required."),
    );
  });
});
