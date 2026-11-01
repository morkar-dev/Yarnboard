/** Step 2 of submitting a pattern: edit the scraped draft, then save it.
 * Receives its draft via router state from SubmitPatternPage rather than
 * a URL param, since a draft is never persisted anywhere until Save is
 * clicked.
 *
 * Saving here only ever creates a *private* Pattern row (see Pattern.
 * is_public's docstring in backend/app/models.py) -- it doesn't publish
 * to the community, so there's no consent gate here the way there used
 * to be. That gate now lives on PatternVisibilityPanel, shown at the
 * point a pattern actually does become public.
 *
 * A pattern from pasted text or photos may arrive with no originalUrl
 * (saved with no source link -- see submit_pattern), and one from photos
 * also brings its first photo, uploaded as the pattern's picture right
 * after the pattern is created (unless the user unticks that). */
import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Form } from "react-bootstrap";
import { useTranslation } from "react-i18next";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { submitPattern, uploadPatternPhoto } from "../api/client";
import PatternReviewForm from "../components/PatternReviewForm";
import { useApiErrorMessage } from "../i18n/useApiErrorMessage";
import type { PatternDraft } from "../types/models";
import { useUnsavedChangesWarning } from "../utils/useUnsavedChangesWarning";

interface LocationState {
  draft: PatternDraft;
  /** "" for a text/photo pattern with no source link. */
  originalUrl: string;
  /** First photo of a photographed pattern, already shrunk. */
  photo?: File;
}

export default function ReviewPatternPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const getErrorMessage = useApiErrorMessage();
  const state = location.state as LocationState | null;

  const [draft, setDraft] = useState<PatternDraft | null>(state?.draft ?? null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [usePhoto, setUsePhoto] = useState(true);
  const photoPreview = useMemo(() => (state?.photo ? URL.createObjectURL(state.photo) : null), [state?.photo]);
  useEffect(() => () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
  }, [photoPreview]);

  // Warn on tab close/refresh once the draft has actually been touched --
  // comparing against the original scraped draft (not just "any draft
  // exists") so simply opening this page doesn't itself count as unsaved
  // work. Cleared once saving succeeds and this page navigates away, so
  // that navigation itself doesn't trigger the prompt.
  useUnsavedChangesWarning(
    !!draft && !!state && JSON.stringify(draft) !== JSON.stringify(state.draft),
  );

  if (!state || !draft) {
    // Reached directly (e.g. page refresh) without a draft in memory --
    // send the user back to start over, since we never persist drafts.
    return <Navigate to="/submit" replace />;
  }

  async function handleSave() {
    if (!draft) return;
    setError(null);
    setSaving(true);
    try {
      const result = await submitPattern({ ...draft, original_url: state!.originalUrl });
      if (state!.photo && usePhoto) {
        try {
          await uploadPatternPhoto(result.pattern.id, state!.photo);
        } catch {
          // The pattern itself is saved; a photo can still be added from
          // its Edit page, so don't block on this.
        }
      }
      navigate(`/pattern/${result.pattern.id}`);
    } catch (err) {
      setError(getErrorMessage(err, t("review.saveFailed")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1 className="mb-2">{t("review.title")}</h1>
      <p className="text-muted">
        {state.originalUrl ? t("review.sourceLabel", { url: state.originalUrl }) : t("review.noSourceLabel")}
      </p>
      {photoPreview && (
        <div className="d-flex align-items-center gap-3 mb-3">
          <img src={photoPreview} alt="" className="review-photo-preview" />
          <Form.Check
            type="checkbox"
            id="review-use-photo"
            label={t("review.usePhotoLabel")}
            checked={usePhoto}
            onChange={(e) => setUsePhoto(e.target.checked)}
          />
        </div>
      )}
      <PatternReviewForm draft={draft} onChange={setDraft} />
      <Alert variant="light" className="my-4">
        {t("review.saveNotice")}
      </Alert>
      {error && <Alert variant="danger">{error}</Alert>}
      <Button variant="primary" disabled={saving} onClick={handleSave}>
        {saving ? t("review.saving") : t("review.saveButton")}
      </Button>
    </div>
  );
}
