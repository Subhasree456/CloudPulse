import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Button, DataSourceBadge, ModeBadge, ProgressBar, SeverityBadge, StatusBadge, Toggle } from "./ui";

afterEach(cleanup);

describe("badges", () => {
  it("renders server status labels", () => {
    render(<StatusBadge status="critical" />);
    expect(screen.getByText("Critical")).toBeInTheDocument();
  });

  it("renders alert severity and data modes", () => {
    render(
      <>
        <SeverityBadge severity="warning" />
        <ModeBadge mode="demo" />
        <ModeBadge mode="live" />
        <DataSourceBadge source="all" />
      </>,
    );
    expect(screen.getByText("Warning")).toBeInTheDocument();
    expect(screen.getByText("Demo data")).toHaveAttribute("title", expect.stringContaining("simulated"));
    expect(screen.getByText("Live data")).toBeInTheDocument();
    expect(screen.getByText("All sources")).toBeInTheDocument();
  });
});

describe("Button", () => {
  it("fires click handlers", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("disables itself while loading", () => {
    render(
      <Button loading variant="primary">
        Saving
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Saving" })).toBeDisabled();
  });
});

describe("Toggle", () => {
  it("exposes switch semantics and reports changes", () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Enable alerts" />);
    const toggle = screen.getByRole("switch", { name: "Enable alerts" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("ProgressBar", () => {
  it("clamps values between 0 and 100", () => {
    const { container, rerender } = render(<ProgressBar value={150} height="h-1" />);
    const track = container.firstElementChild as HTMLElement;
    expect(track.firstElementChild).not.toBeNull();
    expect((track.firstElementChild as HTMLElement).style.width).toBe("100%");
    rerender(<ProgressBar value={-20} height="h-1" />);
    expect((track.firstElementChild as HTMLElement).style.width).toBe("0%");
  });
});
