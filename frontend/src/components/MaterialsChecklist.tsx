/**
 * A pattern's materials, shown like an instruction part (see
 * PatternChecklist): one tick-off item per line (utils/patternText's
 * parseListItems), while "#" heading and "> " note lines render as
 * headings and notes with no checkbox. "[name](url)" links (kept by the
 * scraper, or typed by an editor) stay real links.
 *
 * Ticks live in this browser only (see utils/materialChecks for why they
 * aren't synced like instruction progress). They're keyed by the
 * *primary* text, so switching the page to a translation keeps them:
 * `displayText`, when given, only replaces what's shown, matched by line
 * index -- the same overlay rule PatternChecklist uses for steps.
 */
import { createElement, useState } from "react";
import { Form } from "react-bootstrap";
import { getMaterialChecks, setMaterialChecks } from "../utils/materialChecks";
import { parseListItems, parseStep, renderInlineLinks, stripStepMarker } from "../utils/patternText";
import { NoteIcon } from "./Icons";

interface Props {
  patternId: number;
  materials: string;
  displayText?: string | null;
}

export default function MaterialsChecklist({ patternId, materials, displayText }: Props) {
  const [checked, setChecked] = useState(() => getMaterialChecks(patternId));
  const items = parseListItems(materials);
  const shown = displayText ? parseListItems(displayText) : null;
  // A translation with a different number of lines can't be matched up
  // item-for-item, so fall back to the primary text rather than mislabel.
  const labels = shown && shown.length === items.length ? shown : items;

  function toggle(item: string, next: boolean) {
    setChecked((prev) => {
      const updated = new Set(prev);
      if (next) updated.add(item);
      else updated.delete(item);
      setMaterialChecks(patternId, updated);
      return updated;
    });
  }

  return (
    <div className="materials-checklist d-flex flex-column gap-2" dir="auto">
      {items.map((item, i) => {
        // The line's kind comes from the primary text, like a step's.
        const parsed = parseStep(item);
        const text = labels === items ? parsed.text : stripStepMarker(labels[i]);
        if (parsed.kind === "heading") {
          // Same heading levels as PatternChecklist uses for steps.
          const tag = `h${Math.min(parsed.level + 2, 6)}`;
          return createElement(
            tag,
            { key: `${i}-${item}`, dir: "auto", className: `checklist-heading checklist-heading-${parsed.level} mb-0 mt-2` },
            renderInlineLinks(text),
          );
        }
        if (parsed.kind === "note") {
          return (
            <div key={`${i}-${item}`} className="checklist-note d-flex gap-2 small" dir="auto">
              <NoteIcon size={16} className="flex-shrink-0 mt-1" />
              <span>{renderInlineLinks(text)}</span>
            </div>
          );
        }
        return (
          <Form.Check
            key={`${i}-${item}`}
            type="checkbox"
            id={`material-${i}`}
            label={renderInlineLinks(text)}
            dir="auto"
            checked={checked.has(item)}
            onChange={(e) => toggle(item, e.target.checked)}
          />
        );
      })}
    </div>
  );
}
