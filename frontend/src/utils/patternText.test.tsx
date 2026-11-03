import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { parseListItems, parseRepeat, parseStep, renderInlineLinks, stripStepMarker } from "./patternText";

describe("parseStep", () => {
  it("reads every heading level from its # count", () => {
    expect(parseStep("# Body")).toEqual({ kind: "heading", level: 1, text: "Body" });
    expect(parseStep("### Decreases")).toEqual({ kind: "heading", level: 3, text: "Decreases" });
    expect(parseStep("###### Tiny")).toEqual({ kind: "heading", level: 6, text: "Tiny" });
  });

  it("treats > lines and Note:/הערה: lines as notes", () => {
    expect(parseStep("> Place a marker")).toEqual({ kind: "note", text: "Place a marker" });
    expect(parseStep("Note: work loosely").kind).toBe("note");
    expect(parseStep("הערה: לסרוג ברפיון").kind).toBe("note");
  });

  it("leaves hashtags without a space, and plain steps, as checkable steps", () => {
    expect(parseStep("#5 crochet hook").kind).toBe("step");
    expect(parseStep("Cast on 40.")).toEqual({ kind: "step", text: "Cast on 40.", repeat: null });
  });

  it("strips a heading/note marker from a translated overlay", () => {
    expect(stripStepMarker("## גוף")).toBe("גוף");
    expect(stripStepMarker("> הערה")).toBe("הערה");
    expect(stripStepMarker("Knit 2")).toBe("Knit 2");
  });
});

describe("parseRepeat", () => {
  it("counts an inclusive row range at the start of a step", () => {
    expect(parseRepeat("5-10: k2, p2")).toEqual({ from: 5, to: 10, count: 6 });
    expect(parseRepeat("Rows 3–4. Knit")).toEqual({ from: 3, to: 4, count: 2 });
    expect(parseRepeat("Rnds 12 — 20 knit")).toEqual({ from: 12, to: 20, count: 9 });
    expect(parseRepeat("שורות 1-4: סריגה")).toEqual({ from: 1, to: 4, count: 4 });
  });

  it("ignores ranges that aren't at the start, run backwards, or are absurdly long", () => {
    expect(parseRepeat("Knit rows 5-10")).toBeNull();
    expect(parseRepeat("10-5 knit")).toBeNull();
    expect(parseRepeat("1-2000 knit")).toBeNull();
    expect(parseRepeat("Row 5: knit")).toBeNull();
  });
});

describe("materials", () => {
  it("splits lines and strips bullets", () => {
    expect(parseListItems("- Yarn\n\n• 4mm needles\n1. Scissors")).toEqual(["Yarn", "4mm needles", "Scissors"]);
  });

  it("renders http(s) markdown links only", () => {
    render(<p>{renderInlineLinks("Yarn: [Drops Air](https://example.com/air), [bad](javascript:alert(1))")}</p>);
    const link = screen.getByRole("link", { name: "Drops Air" });
    expect(link).toHaveAttribute("href", "https://example.com/air");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByRole("link", { name: "bad" })).toBeNull();
  });
});
