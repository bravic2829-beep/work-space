import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Plus } from "lucide-react";
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
  EmptyState,
  FormField,
  initials,
  Input,
  LoadingState,
  PageHeader,
  Select,
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
