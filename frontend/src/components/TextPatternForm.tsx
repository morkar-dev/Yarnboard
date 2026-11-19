/**
 * "Paste text" tab of SubmitPatternPage: a pattern typed or copied from
 * anywhere (a book, a message, a site that won't load) becomes a draft via
 * POST /api/patterns/preview-text. The source link is optional -- without
 * one the pattern is saved with no "on <site>" attribution link (see
 * Pattern.has_source_link).
 */
import { useState, type FormEvent } from "react";
import { Alert, Button, Form } from "react-bootstrap";
import { useTranslation } from "react-i18next";
import { previewPatternFromText } from "../api/client";
import { useApiErrorMessage } from "../i18n/useApiErrorMessage";
import type { PreviewResponse } from "../types/models";

interface Props {
  onResult: (result: PreviewResponse, originalUrl: string) => void;
}

export default function TextPatternForm({ onResult }: Props) {
  const { t } = useTranslation();
  const getErrorMessage = useApiErrorMessage();
  const [text, setText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const url = sourceUrl.trim();
      onResult(await previewPatternFromText(text, url), url);
    } catch (err) {
      setError(getErrorMessage(err, t("submit.genericTextError")));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Form onSubmit={handleSubmit} className="mb-2" style={{ maxWidth: "40rem" }}>
      <Form.Group className="mb-3" controlId="submit-text">
        <Form.Label>{t("submit.textLabel")}</Form.Label>
        <Form.Control
          as="textarea"
          rows={10}
          dir="auto"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("submit.textPlaceholder")}
          required
        />
        <Form.Text>{t("submit.textHint")}</Form.Text>
      </Form.Group>
      <Form.Group className="mb-3" controlId="submit-text-source">
        <Form.Label>{t("submit.sourceUrlLabel")}</Form.Label>
        <Form.Control
          type="url"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder={t("submit.urlPlaceholder")}
        />
      </Form.Group>
      {error && <Alert variant="danger">{error}</Alert>}
      <Button type="submit" variant="primary" disabled={loading || !text.trim()}>
        {loading ? t("submit.processing") : t("submit.textButton")}
      </Button>
    </Form>
  );
}
