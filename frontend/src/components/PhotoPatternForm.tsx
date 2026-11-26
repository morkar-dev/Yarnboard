/**
 * "Photos" tab of SubmitPatternPage: up to MAX_PHOTOS pictures of a
 * printed or handwritten pattern, read by the AI (Groq or Gemini) into a
 * draft (POST /api/patterns/preview-photos). Photos are shrunk in the browser first
 * (utils/resizeImage) -- that also makes iPhone HEIC photos work -- and the
 * first one is handed on to the review page to become the pattern's
 * picture. `accept="image/*"` lets phones offer the camera directly.
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Alert, Button, CloseButton, Form } from "react-bootstrap";
import { useTranslation } from "react-i18next";
import { previewPatternFromPhotos } from "../api/client";
import { useApiErrorMessage } from "../i18n/useApiErrorMessage";
import type { PreviewResponse } from "../types/models";
import { resizeImage } from "../utils/resizeImage";

// Mirrors backend/app/transcription.py's MAX_PHOTOS.
const MAX_PHOTOS = 5;

interface Props {
  onResult: (result: PreviewResponse, originalUrl: string, photo: File) => void;
}

export default function PhotoPatternForm({ onResult }: Props) {
  const { t } = useTranslation();
  const getErrorMessage = useApiErrorMessage();
  const [photos, setPhotos] = useState<File[]>([]);
  const [sourceUrl, setSourceUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tooMany, setTooMany] = useState(false);

  const previews = useMemo(() => photos.map((photo) => URL.createObjectURL(photo)), [photos]);
  useEffect(() => () => previews.forEach((src) => URL.revokeObjectURL(src)), [previews]);

  function addPhotos(files: FileList | null) {
    if (!files) return;
    const combined = [...photos, ...Array.from(files)];
    setTooMany(combined.length > MAX_PHOTOS);
    setPhotos(combined.slice(0, MAX_PHOTOS));
  }

  function removePhoto(index: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
    setTooMany(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (photos.length === 0) return;
    setError(null);
    setLoading(true);
    try {
      const resized = await Promise.all(photos.map((photo) => resizeImage(photo)));
      const url = sourceUrl.trim();
      onResult(await previewPatternFromPhotos(resized, url), url, resized[0]);
    } catch (err) {
      setError(getErrorMessage(err, t("submit.genericPhotosError")));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Form onSubmit={handleSubmit} className="mb-2" style={{ maxWidth: "40rem" }}>
      <Form.Group className="mb-2" controlId="submit-photos">
        <Form.Label>{t("submit.photosLabel")}</Form.Label>
        <Form.Control
          type="file"
          accept="image/*"
          multiple
          // Reset so picking the same file again (after removing it) still
          // fires onChange.
          value=""
          onChange={(e) => addPhotos((e.target as HTMLInputElement).files)}
          disabled={photos.length >= MAX_PHOTOS}
        />
        <Form.Text>{t("submit.photosHint", { max: MAX_PHOTOS })}</Form.Text>
      </Form.Group>

      {tooMany && (
        <Alert variant="warning" className="py-2 small">
          {t("submit.photosTooMany", { max: MAX_PHOTOS })}
        </Alert>
      )}

      {photos.length > 0 && (
        <ol className="photo-thumbs list-unstyled d-flex flex-wrap gap-2 mb-3">
          {previews.map((src, i) => (
            <li key={src} className="photo-thumb">
              <img src={src} alt={t("submit.photoAlt", { number: i + 1 })} />
              <span className="photo-thumb-number">{i + 1}</span>
              <CloseButton
                className="photo-thumb-remove"
                aria-label={t("submit.removePhoto", { number: i + 1 })}
                onClick={() => removePhoto(i)}
              />
            </li>
          ))}
        </ol>
      )}

      <Form.Group className="mb-3" controlId="submit-photos-source">
        <Form.Label>{t("submit.sourceUrlLabel")}</Form.Label>
        <Form.Control
          type="url"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder={t("submit.urlPlaceholder")}
        />
      </Form.Group>
      {error && <Alert variant="danger">{error}</Alert>}
      <Button type="submit" variant="primary" disabled={loading || photos.length === 0}>
        {loading ? t("submit.readingPhotos") : t("submit.photosButton")}
      </Button>
    </Form>
  );
}
