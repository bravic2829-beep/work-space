import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import { AttachmentsField } from "./AttachmentsField";
import {
  attachmentUrl,
  checkFile,
  deleteAttachment,
  formatSize,
  MAX_FILE_BYTES,
  uploadAttachment,
} from "./attachments";
import { makeField, makeRecord, NAME } from "./fixtures";
import { RecordGrid } from "./RecordGrid";
import { filesOf } from "./schema";
import { displayValue, isComputed, operatorsFor } from "./values";

vi.mock("./attachments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./attachments")>()),
  uploadAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
}));

const FILES = makeField("f-files", "Files", "attachment");
const REPORT = { id: "a-1", name: "SKU_prices.xlsx", size: 2_100_000, content_type: "application/x" };
const NOTES = { id: "a-2", name: "notes.pdf", size: 340_000, content_type: "application/pdf" };

function task(files: unknown[] = []) {
  return makeRecord("r-1", { "f-name": "Prices", "f-files": files });
}

function file(name: string, size = 1000): File {
  return new File([new Uint8Array(size)], name);
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("what a files column is", () => {
  it("is not a cell: nobody types into it, and it is not filtered", () => {
    expect(isComputed(FILES)).toBe(true);
    expect(operatorsFor(FILES)).toEqual([]);
  });

  it("is shown as the list of names", () => {
    expect(displayValue(FILES, [REPORT, NOTES], new Map())).toBe("SKU_prices.xlsx, notes.pdf");
    expect(displayValue(FILES, [], new Map())).toBe("");
    expect(filesOf("nonsense")).toEqual([]);
    expect(filesOf([REPORT, { id: 3 }])).toEqual([REPORT]);
  });
});

describe("the helpers", () => {
  it("writes sizes the way people read them", () => {
    expect(formatSize(12)).toBe("12 B");
    expect(formatSize(340_000)).toBe("340 KB");
    expect(formatSize(2_100_000)).toBe("2.1 MB");
  });

  it("points a download at the server", () => {
    expect(attachmentUrl("a-1")).toBe("/api/v1/attachments/a-1");
  });

  it("stops a file that the server would refuse before it is sent", () => {
    expect(checkFile(file("report.xlsx"))).toBeNull();
    expect(checkFile(file("REPORT.XLSX"))).toBeNull();
    expect(checkFile(file("virus.exe"))).toMatch(/not a kind of file/);
    expect(checkFile(file("noextension"))).toMatch(/not a kind of file/);
    expect(checkFile(file("empty.pdf", 0))).toMatch(/is empty/);
    expect(checkFile(file("big.pdf", MAX_FILE_BYTES + 1))).toMatch(/too big/);
  });
});

describe("AttachmentsField", () => {
  function setup(record = task([REPORT]), canEdit = true, applyAccept = true) {
    const onChanged = vi.fn();
    render(<AttachmentsField field={FILES} record={record} canEdit={canEdit} onChanged={onChanged} />);
    return { onChanged, user: userEvent.setup({ applyAccept }) };
  }

  it("lists the files, each name a download of the real file", () => {
    setup(task([REPORT, NOTES]));
    const list = screen.getByRole("list", { name: "Files of Files" });
    const links = within(list).getAllByRole("link", { name: "SKU_prices.xlsx" });
    expect(links[0]).toHaveAttribute("href", "/api/v1/attachments/a-1");
    expect(links[0]).toHaveAttribute("download", "SKU_prices.xlsx");
    expect(within(list).getByText("2.1 MB")).toBeInTheDocument();
    expect(within(list).getByText("340 KB")).toBeInTheDocument();
  });

  it("adds the chosen files one after another and shows each new list", async () => {
    const first = task([REPORT]);
    const second = task([REPORT, NOTES]);
    vi.mocked(uploadAttachment).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const { user, onChanged } = setup(task([]));

    await user.upload(screen.getByLabelText("Choose files for Files"), [
      file("SKU_prices.xlsx"),
      file("notes.pdf"),
    ]);
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2));
    expect(onChanged).toHaveBeenLastCalledWith(second);
    expect(uploadAttachment).toHaveBeenCalledWith("r-1", "f-files", expect.any(File));
  });

  it("says why a file was not added and still adds the others", async () => {
    vi.mocked(uploadAttachment).mockRejectedValueOnce(new ApiError("The file is too big.", 413));
    // Dropped files are not filtered by the picker's `accept`, so the check has to catch them.
    const { user, onChanged } = setup(task([]), true, false);
    await user.upload(screen.getByLabelText("Choose files for Files"), [
      file("virus.exe"),
      file("big.xlsx"),
    ]);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("virus.exe” is not a kind of file");
    expect(alert).toHaveTextContent("big.xlsx”: The file is too big.");
    expect(onChanged).not.toHaveBeenCalled();
    expect(uploadAttachment).toHaveBeenCalledTimes(1); // the .exe never left the browser
  });

  it("removes a file after asking", async () => {
    const without = task([]);
    vi.mocked(deleteAttachment).mockResolvedValue(without);
    const { user, onChanged } = setup();
    await user.click(screen.getByRole("button", { name: "Remove SKU_prices.xlsx" }));
    await user.click(screen.getByRole("button", { name: "Yes, remove" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(without));
    expect(deleteAttachment).toHaveBeenCalledWith("a-1");
  });

  it("gives somebody who may only read the list and the downloads, nothing to change", () => {
    setup(task([REPORT]), false);
    expect(screen.getByRole("link", { name: "Download SKU_prices.xlsx" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add files/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Choose files for Files")).not.toBeInTheDocument();
  });

  it("says so when there are no files to see", () => {
    setup(task([]), false);
    expect(screen.getByText("No files.")).toBeInTheDocument();
  });

  it("asks to save a new task first", () => {
    render(<AttachmentsField field={FILES} record={null} canEdit onChanged={vi.fn()} />);
    expect(screen.getByText(/Save the task first/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add files/ })).not.toBeInTheDocument();
  });
});

describe("the files in the table", () => {
  it("shows each file as a download link with a paperclip", () => {
    render(
      <RecordGrid
        fields={[NAME, FILES].map((f, position) => ({ ...f, position }))}
        records={[task([REPORT, NOTES])]}
        names={new Map()}
        sort={[]}
        selectedId={null}
        hasMore={false}
        loadingMore={false}
        onSort={vi.fn()}
        onSelect={vi.fn()}
        onLoadMore={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("2 files")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "SKU_prices.xlsx" });
    expect(link).toHaveAttribute("href", "/api/v1/attachments/a-1");
    expect(link).toHaveAttribute("download", "SKU_prices.xlsx");
    // Not a column to sort by.
    expect(screen.queryByRole("button", { name: "Sort by Files" })).not.toBeInTheDocument();
  });
});
