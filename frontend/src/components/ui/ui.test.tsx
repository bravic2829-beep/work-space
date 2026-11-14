import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Plus } from "lucide-react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { cn } from "@/lib/cn";

import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  Drawer,
  DrawerBody,
  DrawerFooter,
  EmptyState,
  FormField,
  initials,
  Input,
  LoadingState,
  PageHeader,
  SegmentedControl,
  Select,
  Tabs,
  Textarea,
} from ".";

describe("cn", () => {
  it("joins the strings and drops everything else", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
    expect(cn()).toBe("");
  });
});

describe("Button", () => {
  it("does not submit a form unless asked to", async () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button>Plain</Button>
        <Button type="submit">Send</Button>
      </form>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Plain" }));
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("is blocked while loading and when disabled", async () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();

    rerender(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("keeps the icon out of the accessible name", () => {
    render(<Button icon={Plus}>Add</Button>);
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
    expect(document.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("can be an icon-only button with an aria-label", () => {
    render(
      <Button size="icon" aria-label="Close">
        <Plus aria-hidden />
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("applies the variant and merges a custom class", () => {
    render(
      <Button variant="danger" className="mt-9">
        Delete
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Delete" });
    expect(button).toHaveClass("bg-danger", "mt-9");
  });
});

describe("form controls", () => {
  it("marks an invalid control", () => {
    render(
      <>
        <Input aria-label="a" invalid />
        <Textarea aria-label="b" invalid />
        <Select aria-label="c" invalid />
        <Input aria-label="d" />
      </>,
    );
    for (const name of ["a", "b", "c"]) {
      expect(screen.getByLabelText(name)).toHaveAttribute("aria-invalid", "true");
    }
    expect(screen.getByLabelText("d")).not.toHaveAttribute("aria-invalid");
  });

  it("toggles a checkbox from its text", async () => {
    const onChange = vi.fn();
    render(<Checkbox label="Remember me" onChange={onChange} />);
    await userEvent.click(screen.getByText("Remember me"));
    expect(onChange).toHaveBeenCalled();
    expect(screen.getByLabelText("Remember me")).toBeChecked();
  });
});

describe("FormField", () => {
  it("labels the control it wraps", async () => {
    render(
      <FormField label="Employee code">
        <Input />
      </FormField>,
    );
    await userEvent.type(screen.getByLabelText("Employee code"), "E1");
    expect(screen.getByLabelText("Employee code")).toHaveValue("E1");
  });

  it("shows a hint, and an error that is announced but not part of the label", () => {
    render(
      <FormField label="Name" hint="As on the card" error="Required">
        <Input />
      </FormField>,
    );
    expect(screen.getByText("As on the card")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Required");
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });

  it("shows no alert without an error", () => {
    render(
      <FormField label="Name">
        <Input />
      </FormField>,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("Alert", () => {
  it("announces an error or a warning at once", () => {
    const { rerender } = render(<Alert>Broken</Alert>);
    expect(screen.getByRole("alert")).toHaveTextContent("Broken");
    rerender(<Alert tone="warning">Careful</Alert>);
    expect(screen.getByRole("alert")).toHaveTextContent("Careful");
  });

  it("announces a success or a note politely", () => {
    const { rerender } = render(<Alert tone="success">Saved</Alert>);
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    rerender(<Alert tone="info">FYI</Alert>);
    expect(screen.getByRole("status")).toHaveTextContent("FYI");
  });
});

describe("feedback and layout", () => {
  it("shows a loading status with a default and a custom text", () => {
    const { rerender } = render(<LoadingState />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    rerender(<LoadingState>Checking…</LoadingState>);
    expect(screen.getByRole("status")).toHaveTextContent("Checking…");
  });

  it("shows an empty state with an optional description", () => {
    const { rerender } = render(<EmptyState title="Nothing here" />);
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    rerender(
      <EmptyState icon={Plus} title="Nothing here">
        Add something
      </EmptyState>,
    );
    expect(screen.getByText("Add something")).toBeInTheDocument();
  });

  it("shows a page header with a description and actions", () => {
    render(
      <PageHeader title="Trash" description="Deleted records" actions={<button>Empty</button>} />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Trash" })).toBeInTheDocument();
    expect(screen.getByText("Deleted records")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Empty" })).toBeInTheDocument();
  });

  it("renders a table inside a frame, and a card and a badge", () => {
    render(
      <>
        <DataTable aria-label="People">
          <thead>
            <tr>
              <th>Name</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Ann</td>
            </tr>
          </tbody>
        </DataTable>
        <Card>Inside</Card>
        <Badge tone="success">Done</Badge>
      </>,
    );
    expect(screen.getByRole("table", { name: "People" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Ann" })).toBeInTheDocument();
    expect(screen.getByText("Inside")).toBeInTheDocument();
    expect(screen.getByText("Done")).toHaveClass("bg-success-soft");
  });
});

describe("Avatar", () => {
  it("takes up to two initials", () => {
    expect(initials("Tran Thi B")).toBe("TB");
    expect(initials("  ann  ")).toBe("A");
    expect(initials("Nguyen Van An Binh")).toBe("NB");
    expect(initials("")).toBe("?");
    expect(initials("   ")).toBe("?");
  });

  it("is decorative: hidden from screen readers", () => {
    render(<Avatar name="Ann Lee" />);
    expect(screen.getByText("AL")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("Drawer", () => {
  function Harness({ onClose = () => {} }: { onClose?: () => void }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open</button>
        <Drawer
          open={open}
          title="Edit thing"
          subtitle="T-1"
          onClose={() => {
            onClose();
            setOpen(false);
          }}
        >
          <DrawerBody>
            <label>
              First
              <input />
            </label>
          </DrawerBody>
          <DrawerFooter>
            <button>Save</button>
          </DrawerFooter>
        </Drawer>
      </>
    );
  }

  it("renders nothing while closed, and a named dialog with its title and subtitle when open", async () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("dialog", { name: "Edit thing" })).toBeInTheDocument();
    expect(screen.getByText("T-1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("puts the focus in the first field", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByLabelText("First")).toHaveFocus();
  });

  it("closes with the close button and with Escape, and gives the focus back", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await userEvent.click(screen.getByRole("button", { name: "Close panel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toHaveFocus();

    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("does not steal the focus back if the user moved it elsewhere", async () => {
    render(
      <>
        <input aria-label="Elsewhere" />
        <Harness />
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await userEvent.click(screen.getByLabelText("Elsewhere"));
    await userEvent.keyboard("{Escape}");
    expect(screen.getByLabelText("Elsewhere")).toHaveFocus();
  });
});

describe("Tabs", () => {
  function Harness() {
    const [value, setValue] = useState<"a" | "b" | "c">("a");
    return (
      <Tabs
        label="Sections"
        idPrefix="t"
        value={value}
        onChange={setValue}
        tabs={[
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta", count: 3 },
          { id: "c", label: "Gamma" },
        ]}
      />
    );
  }

  it("marks the selected tab, and shows a count", async () => {
    render(<Harness />);
    expect(screen.getByRole("tablist", { name: "Sections" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Beta/ })).toHaveTextContent("3");

    await userEvent.click(screen.getByRole("tab", { name: /Beta/ }));
    expect(screen.getByRole("tab", { name: /Beta/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute("aria-selected", "false");
  });

  it("only the selected tab is in the tab order, and arrows wrap around", async () => {
    render(<Harness />);
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Gamma" })).toHaveAttribute("tabindex", "-1");

    screen.getByRole("tab", { name: "Alpha" }).focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Gamma" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Gamma" })).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveFocus();
  });

  it("points each tab at its panel", () => {
    render(<Harness />);
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute("aria-controls", "t-panel-a");
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute("id", "t-tab-a");
  });
});

describe("SegmentedControl", () => {
  function Harness({ onChange = () => {} }: { onChange?: (value: string) => void }) {
    const [value, setValue] = useState("all");
    return (
      <SegmentedControl
        label="Status"
        value={value}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
        options={[
          { value: "all", label: "All" },
          { value: "on", label: "On" },
        ]}
      />
    );
  }

  it("is a radio group with the current choice checked", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(screen.getByRole("radiogroup", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "All" })).toBeChecked();

    await userEvent.click(screen.getByRole("radio", { name: "On" }));
    expect(onChange).toHaveBeenCalledWith("on");
    expect(screen.getByRole("radio", { name: "On" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "All" })).not.toBeChecked();
  });

  it("is blocked when disabled", async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="Status"
        value="all"
        disabled
        onChange={onChange}
        options={[
          { value: "all", label: "All" },
          { value: "on", label: "On" },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "On" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("DataTable dense", () => {
  it("renders the same table with the dense styling only when asked", () => {
    render(
      <>
        <DataTable aria-label="Plain">
          <tbody>
            <tr>
              <td>a</td>
            </tr>
          </tbody>
        </DataTable>
        <DataTable dense aria-label="Compact">
          <tbody>
            <tr>
              <td>b</td>
            </tr>
          </tbody>
        </DataTable>
      </>,
    );
    expect(screen.getByRole("table", { name: "Plain" }).className).not.toContain("[&_td]:h-8");
    expect(screen.getByRole("table", { name: "Compact" }).className).toContain("[&_td]:h-8");
  });
});

describe("control width", () => {
  it("fills the row by default, and gives way when the caller sets a width", () => {
    render(
      <>
        <Input aria-label="plain" />
        <Select aria-label="sized" className="w-auto" />
        <Textarea aria-label="area" className="w-40" />
        <Input aria-label="spaced" className="min-w-36" />
      </>,
    );
    expect(screen.getByLabelText("plain")).toHaveClass("w-full");
    expect(screen.getByLabelText("sized")).toHaveClass("w-auto");
    expect(screen.getByLabelText("sized")).not.toHaveClass("w-full");
    expect(screen.getByLabelText("area")).not.toHaveClass("w-full");
    // min-w-* is not a width: the control still fills its row.
    expect(screen.getByLabelText("spaced")).toHaveClass("w-full");
  });
});
