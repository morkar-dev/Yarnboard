import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import MaterialsChecklist from "./MaterialsChecklist";

const MATERIALS = "- Yarn: [Drops Air](https://example.com/air), 2 skeins\n- 4mm needles";

describe("MaterialsChecklist", () => {
  beforeEach(() => localStorage.clear());

  it("renders one tick box per material, with links kept", () => {
    render(<MaterialsChecklist patternId={1} materials={MATERIALS} />);
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Drops Air" })).toHaveAttribute("href", "https://example.com/air");
  });

  it("remembers ticks per pattern, keyed by the item's text", () => {
    const { unmount } = render(<MaterialsChecklist patternId={1} materials={MATERIALS} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "4mm needles" }));
    unmount();

    // A line added above doesn't move the tick onto the wrong item.
    render(<MaterialsChecklist patternId={1} materials={`- Scissors\n${MATERIALS}`} />);
    expect(screen.getByRole("checkbox", { name: "Scissors" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "4mm needles" })).toBeChecked();
  });

  it("doesn't share ticks between patterns", () => {
    const { unmount } = render(<MaterialsChecklist patternId={1} materials={MATERIALS} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "4mm needles" }));
    unmount();
    render(<MaterialsChecklist patternId={2} materials={MATERIALS} />);
    expect(screen.getByRole("checkbox", { name: "4mm needles" })).not.toBeChecked();
  });

  it("shows a translation but keeps ticks on the primary items", () => {
    const { unmount } = render(<MaterialsChecklist patternId={1} materials={MATERIALS} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "4mm needles" }));
    unmount();
    render(<MaterialsChecklist patternId={1} materials={MATERIALS} displayText={"- צמר, 2 פקעות\n- מסרגות 4 מ״מ"} />);
    expect(screen.getByRole("checkbox", { name: "מסרגות 4 מ״מ" })).toBeChecked();
  });

  it("falls back to the primary text when a translation's lines don't line up", () => {
    render(<MaterialsChecklist patternId={1} materials={MATERIALS} displayText="- רק שורה אחת" />);
    expect(screen.getByRole("checkbox", { name: "4mm needles" })).toBeInTheDocument();
  });

  it("shows headings and notes like the instructions, with no tick box", () => {
    render(<MaterialsChecklist patternId={1} materials={"## Yarn\n- Drops Air\n> Any DK works"} />);
    expect(screen.getByRole("heading", { name: "Yarn" })).toBeInTheDocument();
    expect(screen.getByText("Any DK works")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  });
});
