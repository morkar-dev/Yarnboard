/**
 * One editable line per item, each with its own delete button, plus
 * "+ Add <item>", "+ Add heading" and "+ Add note" -- the editor
 * PatternReviewForm uses for both an instruction part's steps and the
 * materials list, so the two are edited the same way. Headings ("## ")
 * and notes ("> ") follow utils/patternText's conventions and render
 * without a checkbox on the pattern page.
 */
import { Button, Form, InputGroup } from "react-bootstrap";
import { useTranslation } from "react-i18next";

interface Props {
  lines: string[];
  onChange: (lines: string[]) => void;
  addLabel: string;
  /** Accessible name for line `number` (1-based), for its input and its
   * delete button. */
  inputLabel: (number: number) => string;
  deleteLabel: (number: number) => string;
}

export default function StepListEditor({ lines, onChange, addLabel, inputLabel, deleteLabel }: Props) {
  const { t } = useTranslation();

  function update(index: number, text: string) {
    onChange(lines.map((line, i) => (i === index ? text : line)));
  }

  return (
    <>
      {lines.map((line, index) => (
        <InputGroup key={index}>
          <Form.Control
            dir="auto"
            value={line}
            aria-label={inputLabel(index + 1)}
            onChange={(e) => update(index, e.target.value)}
          />
          <Button
            variant="outline-secondary"
            onClick={() => onChange(lines.filter((_, i) => i !== index))}
            title={deleteLabel(index + 1)}
            aria-label={deleteLabel(index + 1)}
          >
            &times;
          </Button>
        </InputGroup>
      ))}
      <div className="d-flex flex-wrap gap-2">
        <Button variant="outline-primary" size="sm" onClick={() => onChange([...lines, ""])}>
          {addLabel}
        </Button>
        <Button variant="outline-secondary" size="sm" onClick={() => onChange([...lines, "## "])}>
          {t("reviewForm.addHeading")}
        </Button>
        <Button variant="outline-secondary" size="sm" onClick={() => onChange([...lines, "> "])}>
          {t("reviewForm.addNote")}
        </Button>
      </div>
    </>
  );
}
