/**
 * Editable form for a scraped draft (title/author/materials/abbreviations/
 * instructions) before publishing. The scraper is only best-effort (see
 * backend/app/scraper.py), so every field here is editable rather than
 * read-only -- this is the human review step that makes the heuristic
 * extraction trustworthy enough to publish.
 *
 * Every text field uses dir="auto" rather than inheriting the page's
 * ambient direction (which follows the UI language toggle, see
 * main.tsx's applyDirection) -- a pattern's own content is independent of
 * whatever language the UI chrome happens to be in (e.g. a Hebrew-
 * sourced pattern reviewed while the UI is still in English, or vice
 * versa), so each field needs to detect and align to *its own* text
 * per-field, via the browser's native bidi algorithm, not the
 * surrounding page's direction.
 */
import { Button, Card, Form, InputGroup } from "react-bootstrap";
import { useTranslation } from "react-i18next";
import { resolvePhotoUrl } from "../api/client";
import type { PatternDraft } from "../types/models";
import StepListEditor from "./StepListEditor";

interface Props {
  draft: PatternDraft;
  onChange: (draft: PatternDraft) => void;
}

export default function PatternReviewForm({ draft, onChange }: Props) {
  const { t } = useTranslation();

  function updateField<K extends keyof PatternDraft>(field: K, value: PatternDraft[K]) {
    onChange({ ...draft, [field]: value });
  }

  function updatePartName(oldName: string, newName: string) {
    if (!newName || newName === oldName) return;
    const entries = Object.entries(draft.instructions).map(([name, steps]) =>
      name === oldName ? [newName, steps] : [name, steps],
    ) as [string, string[]][];
    updateField("instructions", Object.fromEntries(entries));
  }

  function updateSteps(part: string, steps: string[]) {
    updateField("instructions", { ...draft.instructions, [part]: steps });
  }

  /** Removes an entire part (e.g. a stray "Pin for Later" divider section
   * the scraper misread as an instruction part). */
  function deletePart(part: string) {
    const { [part]: _removed, ...rest } = draft.instructions;
    updateField("instructions", rest);
  }

  function addPart() {
    const name = `Part ${Object.keys(draft.instructions).length + 1}`;
    updateField("instructions", { ...draft.instructions, [name]: [""] });
  }

  /** Swaps a part with its neighbor in the opposite direction. Object key
   * order (JS preserves string-key insertion order) is what determines the
   * part order everywhere else this draft is rendered -- the checklist,
   * the published pattern -- so reordering means rebuilding the object
   * with keys in the new order, not just relabeling anything. */
  function movePart(part: string, direction: -1 | 1) {
    const entries = Object.entries(draft.instructions);
    const index = entries.findIndex(([name]) => name === part);
    const swapWith = index + direction;
    if (swapWith < 0 || swapWith >= entries.length) return;
    [entries[index], entries[swapWith]] = [entries[swapWith], entries[index]];
    updateField("instructions", Object.fromEntries(entries));
  }

  return (
    <div className="d-flex flex-column gap-3">
      <Form.Group controlId="review-title">
        <Form.Label>{t("reviewForm.titleLabel")}</Form.Label>
        <Form.Control
          dir="auto"
          value={draft.title}
          onChange={(e) => updateField("title", e.target.value)}
        />
      </Form.Group>

      {draft.photo_url && (
        <Form.Group controlId="review-photo">
          <Form.Label>{t("reviewForm.photoLabel")}</Form.Label>
          <div>
            <img
              src={resolvePhotoUrl(draft.photo_url)}
              alt={draft.title}
              style={{ maxWidth: "240px", maxHeight: "240px", objectFit: "cover" }}
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          </div>
          <Button
            variant="outline-secondary"
            size="sm"
            className="mt-2"
            onClick={() => updateField("photo_url", null)}
          >
            {t("reviewForm.removePhoto")}
          </Button>
          <Form.Text className="d-block text-muted">{t("reviewForm.photoHint")}</Form.Text>
        </Form.Group>
      )}

      <Form.Group controlId="review-author">
        <Form.Label>{t("reviewForm.authorLabel")}</Form.Label>
        <Form.Control
          dir="auto"
          value={draft.author ?? ""}
          placeholder={t("reviewForm.authorPlaceholder")}
          onChange={(e) => updateField("author", e.target.value || null)}
        />
      </Form.Group>

      {/* Edited line by line, exactly like an instruction part's steps
          (see StepListEditor) -- and shown the same way on the pattern
          page. Stored as one line per item, as before. */}
      <div role="group" aria-labelledby="review-materials-label">
        <Form.Label id="review-materials-label">{t("reviewForm.materialsLabel")}</Form.Label>
        <Card className="shadow-sm">
          <Card.Body className="d-flex flex-column gap-2">
            <StepListEditor
              lines={draft.materials.split("\n")}
              onChange={(lines) => updateField("materials", lines.join("\n"))}
              addLabel={t("reviewForm.addMaterial")}
              inputLabel={(number) => t("reviewForm.materialAria", { number })}
              deleteLabel={(number) => t("reviewForm.deleteMaterialAria", { number })}
              keepOneLine
            />
          </Card.Body>
        </Card>
        <Form.Text className="text-muted">{t("reviewForm.materialsHint")}</Form.Text>
      </div>

      <Form.Group controlId="review-abbreviations">
        <Form.Label>{t("reviewForm.abbreviationsLabel")}</Form.Label>
        <Form.Control
          as="textarea"
          dir="auto"
          rows={3}
          value={draft.abbreviations}
          onChange={(e) => updateField("abbreviations", e.target.value)}
        />
      </Form.Group>

      <h2 className="h5 mt-2 mb-0">{t("reviewForm.instructionsHeading")}</h2>
      <Form.Text className="text-muted mt-0">{t("reviewForm.instructionsHint")}</Form.Text>
      {Object.entries(draft.instructions).map(([part, steps], partIndex, allParts) => (
        <Card key={part} className="shadow-sm">
          <Card.Body className="d-flex flex-column gap-2">
            <InputGroup>
              <Button
                variant="outline-secondary"
                onClick={() => movePart(part, -1)}
                disabled={partIndex === 0}
                title={t("reviewForm.movePartUp")}
                aria-label={t("reviewForm.movePartUpAria", { part })}
              >
                &uarr;
              </Button>
              <Button
                variant="outline-secondary"
                onClick={() => movePart(part, 1)}
                disabled={partIndex === allParts.length - 1}
                title={t("reviewForm.movePartDown")}
                aria-label={t("reviewForm.movePartDownAria", { part })}
              >
                &darr;
              </Button>
              <Form.Control
                className="fw-semibold"
                dir="auto"
                aria-label={t("reviewForm.partNameAria", { number: partIndex + 1 })}
                value={part}
                onChange={(e) => updatePartName(part, e.target.value)}
              />
              <Button
                variant="outline-danger"
                onClick={() => deletePart(part)}
                title={t("reviewForm.deletePart")}
                aria-label={t("reviewForm.deletePartAria", { part })}
              >
                {t("reviewForm.deletePart")}
              </Button>
            </InputGroup>
            <StepListEditor
              lines={steps}
              onChange={(next) => updateSteps(part, next)}
              addLabel={t("reviewForm.addStep")}
              inputLabel={(number) => t("reviewForm.stepAria", { number, part })}
              deleteLabel={(number) => t("reviewForm.deleteStepAria", { number, part })}
            />
          </Card.Body>
        </Card>
      ))}
      <Button variant="outline-primary" className="align-self-start" onClick={addPart}>
        {t("reviewForm.addPart")}
      </Button>
    </div>
  );
}
