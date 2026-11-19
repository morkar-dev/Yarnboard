import { useEffect, useRef, useState } from "react";
import { Alert, Card, Col, Row, Spinner } from "react-bootstrap";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { unsubscribeFromNewsletter } from "../api/client";
import { useApiErrorMessage } from "../i18n/useApiErrorMessage";

type Status = "working" | "done" | "error";

/**
 * Landing page for the unsubscribe link at the bottom of every
 * newsletter (backend/app/email.py's newsletter_html): /unsubscribe?token=...
 * Works without logging in. Unsubscribing twice is harmless, but the
 * request still goes out once per token (StrictMode runs effects twice).
 */
export default function UnsubscribePage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const { t } = useTranslation();
  const getErrorMessage = useApiErrorMessage();
  const [status, setStatus] = useState<Status>("working");
  const [message, setMessage] = useState("");
  const sentToken = useRef<string | null>(null);

  useEffect(() => {
    if (token && sentToken.current === token) return;
    sentToken.current = token;
    if (!token) {
      setStatus("error");
      setMessage(t("unsubscribe.missingToken"));
      return;
    }
    unsubscribeFromNewsletter(token)
      .then(() => setStatus("done"))
      .catch((err) => {
        setStatus("error");
        setMessage(getErrorMessage(err, t("unsubscribe.failed")));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <Row className="justify-content-center">
      <Col xs={12} sm={8} md={6} lg={5}>
        <Card className="shadow-sm">
          <Card.Body>
            <Card.Title as="h1" className="h3 mb-4">
              {t("unsubscribe.title")}
            </Card.Title>
            {status === "working" && (
              <div className="d-flex align-items-center gap-2">
                <Spinner animation="border" size="sm" />
                <span>{t("unsubscribe.working")}</span>
              </div>
            )}
            {status === "done" && <Alert variant="success">{t("unsubscribe.done")}</Alert>}
            {status === "error" && (
              <>
                <Alert variant="danger">{message}</Alert>
                <Link to="/settings/notifications">{t("unsubscribe.settingsLink")}</Link>
              </>
            )}
          </Card.Body>
        </Card>
      </Col>
    </Row>
  );
}
