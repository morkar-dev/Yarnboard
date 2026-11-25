/**
 * Public "What's new" page: every product-update newsletter that went out,
 * newest first (GET /api/updates). Sending one from the admin newsletter
 * page is what adds it here -- there's nothing to write separately.
 */
import { useEffect, useState } from "react";
import { Alert, Card, Spinner } from "react-bootstrap";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { fetchUpdates, type ProductUpdate } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { renderUpdateBody } from "../utils/updateBody";

export default function UpdatesPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [updates, setUpdates] = useState<ProductUpdate[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetchUpdates()
      .then((r) => setUpdates(r.updates))
      .catch(() => setFailed(true));
  }, []);

  const formatDate = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(i18n.language, { dateStyle: "long" }).format(
          // The API's timestamps are UTC without a zone suffix.
          new Date(/(?:[zZ]|[+-]\d\d:\d\d)$/.test(iso) ? iso : `${iso}Z`),
        )
      : "";

  return (
    <div className="d-flex flex-column gap-3">
      <div>
        <h1 className="mb-2">{t("updates.title")}</h1>
        <p className="text-muted mb-0">
          {t("updates.intro")} {t("updates.subscribe")}{" "}
          <Link to={user ? "/settings/notifications" : "/register"}>{t("updates.subscribeLink")}</Link>
        </p>
      </div>

      {failed && <Alert variant="danger">{t("updates.failed")}</Alert>}
      {!failed && updates === null && <Spinner animation="border" variant="primary" />}
      {updates?.length === 0 && <p className="text-muted">{t("updates.empty")}</p>}

      {updates?.map((update) => (
        <Card as="article" key={update.id} id={`update-${update.id}`} className="shadow-sm">
          <Card.Body>
            <Card.Title as="h2" className="h4 mb-1" dir="auto">
              {update.subject}
            </Card.Title>
            {update.sent_at && (
              <time className="text-muted small d-block mb-3" dateTime={update.sent_at}>
                {formatDate(update.sent_at)}
              </time>
            )}
            <div className="update-body">{renderUpdateBody(update.body)}</div>
          </Card.Body>
        </Card>
      ))}
    </div>
  );
}
