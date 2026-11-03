/**
 * A pattern's materials as tick-off items, one per line (see
 * utils/patternText's parseListItems), so supplies can be gathered the same
 * way instructions are worked through. "[name](url)" links (kept by the
 * scraper, or typed by an editor) stay real links in the label.
 *
 * Ticks live in this browser only (see utils/materialChecks for why they
 * aren't synced like instruction progress). They're keyed by the
 * *primary* text, so switching the page to a translation keeps them:
 * `displayText`, when given, only replaces what's shown, matched by line
 * index -- the same overlay rule PatternChecklist uses for steps.
 */
import { useState } from "react";
import { Form } from "react-bootstrap";
import { getMaterialChecks, setMaterialChecks } from "../utils/materialChecks";
import { parseListItems, renderInlineLinks } from "../utils/patternText";

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
      {items.map((item, i) => (
        <Form.Check
          key={`${i}-${item}`}
          type="checkbox"
          id={`material-${i}`}
          label={renderInlineLinks(labels[i])}
          dir="auto"
          checked={checked.has(item)}
          onChange={(e) => toggle(item, e.target.checked)}
        />
      ))}
    </div>
  );
}
