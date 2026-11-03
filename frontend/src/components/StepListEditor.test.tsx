import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import StepListEditor from "./StepListEditor";

function renderEditor(lines: string[], keepOneLine = false) {
  const onChange = vi.fn();
  render(
    <StepListEditor
      lines={lines}
      onChange={onChange}
      addLabel="+ Add item"
      inputLabel={(n) => `Item ${n}`}
      deleteLabel={(n) => `Delete item ${n}`}
      keepOneLine={keepOneLine}
    />,
  );
  return onChange;
}

describe("StepListEditor", () => {
  it("edits, deletes, and adds headings and notes", () => {
    const onChange = renderEditor(["Cast on", "Knit"]);
    fireEvent.change(screen.getByLabelText("Item 2"), { target: { value: "Purl" } });
    expect(onChange).toHaveBeenLastCalledWith(["Cast on", "Purl"]);
    fireEvent.click(screen.getByRole("button", { name: "Delete item 1" }));
    expect(onChange).toHaveBeenLastCalledWith(["Knit"]);
    fireEvent.click(screen.getByRole("button", { name: "+ Add heading" }));
    expect(onChange).toHaveBeenLastCalledWith(["Cast on", "Knit", "## "]);
    fireEvent.click(screen.getByRole("button", { name: "+ Add note" }));
    expect(onChange).toHaveBeenLastCalledWith(["Cast on", "Knit", "> "]);
  });

  it("can delete a part's only step", () => {
    const onChange = renderEditor([""]);
    fireEvent.click(screen.getByRole("button", { name: "Delete item 1" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("with keepOneLine, hides delete on the sole empty line (it would come straight back)", () => {
    renderEditor([""], true);
    expect(screen.getByLabelText("Item 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete item 1" })).not.toBeInTheDocument();
  });

  it("with keepOneLine, still deletes a sole line that has text", () => {
    const onChange = renderEditor(["Yarn"], true);
    fireEvent.click(screen.getByRole("button", { name: "Delete item 1" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
