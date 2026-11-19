/**
 * Admin-only newsletter page: write a product update, preview it as
 * subscribers will see it, send a test to yourself, then send it to every
 * user who turned on product update emails (see
 * backend/app/newsletter/routes.py). Sending has an in-page confirmation
 * naming the subject and the number of recipients, and the server refuses
 * the send if that number changed in the meantime.
 */
import { useEffect, useState, type FormEvent } from "react";
import { Alert, Button, Card, Form, Spinner } from "react-bootstrap";
import { useTranslation } from "react-i18next";
import {
  ApiError,
  fetchNewsletterStatus,
  previewNewsletter,
  sendNewsletter,
  sendTestNewsletter,
} from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useApiErrorMessage } from "../i18n/useApiErrorMessage";

type Busy = null | "preview" | "test" | "send";

export default function AdminNewsletterPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const getErrorMessage = useApiErrorMessage();
  const [count, setCount] = useState<number | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<{ variant: "success" | "danger"; text: string } | null>(null);

  useEffect(() => {
    if (!user?.is_admin) return;
    fetchNewsletterStatus()
      .then((r) => setCount(r.subscriber_count))
      .catch((err) => setNotice({ variant: "danger", text: getErrorMessage(err, t("newsletter.failed")) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.is_admin]);

  if (!user?.is_admin) return <Alert variant="warning">{t("newsletter.adminOnly")}</Alert>;
  if (count === null && !notice) return <Spinner animation="border" variant="primary" />;

  const draft = { subject: subject.trim(), body: body.trim() };
  const ready = draft.subject.length > 0 && draft.body.length > 0;

  function edit(setter: (v: string) => void, value: string) {
    setter(value);
    setPreview(null);
    setConfirming(false);
  }

  async function run(kind: Exclude<Busy, null>, action: () => Promise<void>) {
    setBusy(kind);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      if (err instanceof ApiError && err.code === "subscriber_count_changed") {
        setCount(Number(err.params?.subscriber_count ?? count));
      }
      setConfirming(false);
      setNotice({ variant: "danger", text: getErrorMessage(err, t("newsletter.failed")) });
    } finally {
      setBusy(null);
    }
  }

  function handlePreview(e: FormEvent) {
    e.preventDefault();
    run("preview", async () => setPreview(await previewNewsletter(draft)));
  }

  return (
    <div className="d-flex flex-column gap-3">
      <div>
        <h1 className="mb-2">{t("newsletter.title")}</h1>
        <p className="text-muted mb-0">
          {t("newsletter.intro")}{" "}
          {count !== null && <strong>{t("newsletter.subscribers", { count })}</strong>}
        </p>
      </div>

      {notice && <Alert variant={notice.variant}>{notice.text}</Alert>}
      {count === 0 && <Alert variant="info">{t("newsletter.noSubscribers")}</Alert>}

      <Card className="shadow-sm">
        <Card.Body>
          <Form onSubmit={handlePreview} className="d-flex flex-column gap-3">
            <Form.Group controlId="newsletter-subject">
              <Form.Label>{t("newsletter.subject")}</Form.Label>
              <Form.Control
                value={subject}
                maxLength={150}
                dir="auto"
                onChange={(e) => edit(setSubject, e.target.value)}
              />
            </Form.Group>
            <Form.Group controlId="newsletter-body">
              <Form.Label>{t("newsletter.body")}</Form.Label>
              <Form.Control
                as="textarea"
                rows={12}
                value={body}
                maxLength={20000}
                dir="auto"
                onChange={(e) => edit(setBody, e.target.value)}
              />
              <Form.Text>{t("newsletter.bodyHelp")}</Form.Text>
            </Form.Group>
            <div className="d-flex flex-wrap gap-2">
              <Button type="submit" variant="outline-primary" disabled={!ready || busy !== null}>
                {t("newsletter.preview")}
              </Button>
              <Button
                variant="outline-secondary"
                disabled={!ready || busy !== null}
                onClick={() =>
                  run("test", async () => {
                    const { sent_to } = await sendTestNewsletter(draft);
                    setNotice({ variant: "success", text: t("newsletter.testSent", { email: sent_to }) });
                  })
                }
              >
                {busy === "test" ? <Spinner animation="border" size="sm" /> : t("newsletter.sendTest")}
              </Button>
              <Button
                variant="primary"
                disabled={!ready || busy !== null || !count}
                onClick={() => setConfirming(true)}
              >
                {t("newsletter.send")}
              </Button>
            </div>
          </Form>
        </Card.Body>
      </Card>

      {confirming && count !== null && (
        <Alert variant="warning" className="d-flex flex-column gap-2">
          <span>{t("newsletter.confirm", { count, subject: draft.subject })}</span>
          <div className="d-flex gap-2">
            <Button
              variant="danger"
              disabled={busy !== null}
              onClick={() =>
                run("send", async () => {
                  const { sent } = await sendNewsletter(draft, count);
                  setConfirming(false);
                  setSubject("");
                  setBody("");
                  setPreview(null);
                  setNotice({ variant: "success", text: t("newsletter.sent", { count: sent }) });
                })
              }
            >
              {busy === "send" ? <Spinner animation="border" size="sm" /> : t("newsletter.confirmSend")}
            </Button>
            <Button variant="outline-secondary" disabled={busy !== null} onClick={() => setConfirming(false)}>
              {t("newsletter.cancel")}
            </Button>
          </div>
        </Alert>
      )}

      {preview && (
        <Card className="shadow-sm">
          <Card.Header>
            {t("newsletter.previewTitle")}: <strong dir="auto">{preview.subject}</strong>
          </Card.Header>
          <Card.Body className="p-0">
            {/* The server escapes everything; sandbox blocks scripts anyway. */}
            <iframe
              title={t("newsletter.previewTitle")}
              sandbox=""
              srcDoc={`<body style="font-family:system-ui,sans-serif;margin:16px" dir="auto">${preview.html}</body>`}
              style={{ width: "100%", minHeight: "22rem", border: 0 }}
            />
          </Card.Body>
        </Card>
      )}
    </div>
  );
}
