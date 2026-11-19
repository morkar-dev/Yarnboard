/** Step 1 of submitting a pattern, four explicit, always-available ways
 * in (see `mode` below): paste a URL to scrape, upload a saved page/PDF,
 * paste the pattern's text (TextPatternForm), or photograph it
 * (PhotoPatternForm). Every one hands a preview draft to
 * ReviewPatternPage for editing + the publish-consent gate. See
 * PublishConsentNotice for why the review step isn't skippable. Text and
 * photo patterns may have no source link at all (a book, a handwritten
 * card).
 *
 * "Upload a file" exists for two different reasons that both land on the
 * same form: a PDF (e.g. a paid Etsy/Ravelry pattern that only exists as
 * a PDF in the first place -- there's nothing to "fetch" for those at
 * all) always needs this path, while a normal webpage only needs it when
 * automatic fetching is blocked (e.g. Cloudflare's bot-detection
 * challenge -- see backend/app/scraper.py); the URL field stays required
 * in both cases since it's still what dedup and attribution are based on.
 * A URL-fetch failure also auto-switches to this tab, pre-filled, so the
 * fallback case doesn't need to be discovered separately.
 *
 * This page itself is public (unregistered visitors can read how
 * uploading works), but the actual scrape/submit endpoints all require
 * login server-side -- so anonymous visitors see the explanation plus a
 * login/register prompt instead of the live form, rather than being able
 * to fill it out and only find out it's blocked at the end. */
import { useState, type FormEvent, type ReactNode } from "react";
import { Alert, Button, Form } from "react-bootstrap";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { previewPattern, previewPatternFromUpload } from "../api/client";
import {
  CameraIcon,
  FileIcon,
  LinkIcon,
  LockIcon,
  MonitorIcon,
  PhoneIcon,
  ShieldIcon,
  TextIcon,
} from "../components/Icons";
import PhotoPatternForm from "../components/PhotoPatternForm";
import TextPatternForm from "../components/TextPatternForm";
import { useAuth } from "../context/AuthContext";
import { useApiErrorMessage } from "../i18n/useApiErrorMessage";

type Mode = "link" | "upload" | "text" | "photos";

const MODES: { mode: Mode; icon: ReactNode; labelKey: string }[] = [
  { mode: "link", icon: <LinkIcon size={18} />, labelKey: "submit.modeLink" },
  { mode: "upload", icon: <FileIcon size={18} />, labelKey: "submit.modeUpload" },
  { mode: "text", icon: <TextIcon size={18} />, labelKey: "submit.modeText" },
  { mode: "photos", icon: <CameraIcon size={18} />, labelKey: "submit.modePhotos" },
];

/** Why a link fetch usually fails, and the two ways to upload instead --
 * shown in the failure alert. */
const FAIL_REASONS: { icon: ReactNode; key: string }[] = [
  { icon: <ShieldIcon size={16} />, key: "submit.whyBlocked" },
  { icon: <LockIcon size={16} />, key: "submit.whyLogin" },
  { icon: <LinkIcon size={16} />, key: "submit.whyNotPattern" },
];
const FIX_STEPS: { icon: ReactNode; key: string }[] = [
  { icon: <MonitorIcon size={20} />, key: "submit.howComputer" },
  { icon: <PhoneIcon size={20} />, key: "submit.howPhone" },
];

interface PreviewResult {
  duplicate: boolean;
  existing_pattern_id: number | null;
  already_shared_with_you: number | null;
  draft: unknown;
}

/** Everything the review page needs: the draft, its source link ("" for a
 * text/photo pattern without one), and -- for photos -- the first photo,
 * saved as the pattern's picture after it's created. */
interface PendingReview {
  result: PreviewResult;
  originalUrl: string;
  photo?: File;
}

export default function SubmitPatternPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const getErrorMessage = useApiErrorMessage();
  const [mode, setMode] = useState<Mode>("link");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Set instead of navigating straight to review when the preview came
  // back with already_shared_with_you -- the warning has to actually be
  // seen and give the user a real choice (view the shared pattern
  // instead, or continue with their own copy), not just flash by while
  // the page navigates on regardless (see handleContinueAnyway).
  const [pendingShared, setPendingShared] = useState<PendingReview | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadLoading, setUploadLoading] = useState(false);

  function openReview({ result, originalUrl, photo }: PendingReview) {
    navigate("/submit/review", { state: { draft: result.draft, originalUrl, photo } });
  }

  function goToReview(pending: PendingReview) {
    if (pending.result.duplicate) {
      navigate(`/pattern/${pending.result.existing_pattern_id}`);
      return;
    }
    if (pending.result.already_shared_with_you) {
      setPendingShared(pending);
      return;
    }
    openReview(pending);
  }

  function handleContinueAnyway() {
    if (pendingShared) openReview(pendingShared);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPendingShared(null);
    setLoading(true);
    try {
      goToReview({ result: await previewPattern(url), originalUrl: url });
    } catch (err) {
      setError(getErrorMessage(err, t("submit.genericFetchError")));
      // Any preview failure (blocked by bot-detection, timed out, DNS
      // error, etc.) can potentially be worked around by uploading the
      // page's HTML yourself instead, so switch to that tab (URL
      // preserved) rather than trying to sniff out which failure this was.
      setMode("upload");
    } finally {
      setLoading(false);
    }
  }

  // Decided by the file the user picked (name or type), only to adapt the
  // form; the server checks the file's actual bytes either way.
  const uploadIsPdf =
    !!uploadFile && (uploadFile.type === "application/pdf" || /\.pdf$/i.test(uploadFile.name));

  async function handleUploadPreview(e: FormEvent) {
    e.preventDefault();
    if (!uploadFile) return;
    // The link-fetch failure that brought the user to this tab is stale
    // once they try the upload instead.
    setError(null);
    setUploadError(null);
    setPendingShared(null);
    setUploadLoading(true);
    try {
      const link = url.trim();
      goToReview({ result: await previewPatternFromUpload(link, uploadFile), originalUrl: link });
    } catch (err) {
      setUploadError(getErrorMessage(err, t("submit.genericUploadError")));
    } finally {
      setUploadLoading(false);
    }
  }

  return (
    <div>
      <h1 className="mb-3">{t("submit.title")}</h1>
      <p className="text-muted">{t("submit.intro")}</p>

      {!user ? (
        <Alert variant="light" style={{ maxWidth: "32rem" }}>
          <Link to="/login">{t("submit.guestPromptLogin")}</Link> {t("common.or")}{" "}
          <Link to="/register">{t("submit.guestPromptSignup")}</Link> {t("submit.guestPromptTail")}
        </Alert>
      ) : (
        <>
          <div className="d-flex flex-wrap gap-2 mb-3" role="group" aria-label={t("submit.modeGroupLabel")}>
            {MODES.map((item) => (
              <Button
                key={item.mode}
                variant={mode === item.mode ? "primary" : "outline-primary"}
                aria-pressed={mode === item.mode}
                className="d-inline-flex align-items-center gap-2"
                onClick={() => {
                  setMode(item.mode);
                  setPendingShared(null);
                }}
              >
                {item.icon}
                {t(item.labelKey)}
              </Button>
            ))}
          </div>

          {pendingShared?.result.already_shared_with_you && (
            <Alert variant="warning" style={{ maxWidth: "32rem" }}>
              <p className="mb-2">{t("sharedWithMe.alreadySharedWarning")}</p>
              <div className="d-flex gap-2">
                <Link
                  to={`/pattern/${pendingShared.result.already_shared_with_you}`}
                  className="btn btn-outline-primary btn-sm"
                >
                  {t("submit.viewSharedPattern")}
                </Link>
                <Button variant="outline-secondary" size="sm" onClick={handleContinueAnyway}>
                  {t("submit.continueAnyway")}
                </Button>
              </div>
            </Alert>
          )}

          {/* Above both tabs, not inside the link form: a failed link
              fetch switches to the upload tab (see handleSubmit), and the
              reason it failed has to still be on screen when it does. */}
          {error && (
            <Alert variant="danger" style={{ maxWidth: "32rem" }} onClose={() => setError(null)} dismissible>
              <Alert.Heading as="h2" className="h6">
                {t("submit.fetchFailedTitle")}
              </Alert.Heading>
              <p className="small mb-2">{error}</p>
              {/* Icons + a few words each, same as the home page -- the
                  reasons and the fix should read at a glance. */}
              <ul className="fetch-fail-reasons list-unstyled d-flex flex-wrap gap-2 mb-2">
                {FAIL_REASONS.map(({ icon, key }) => (
                  <li key={key} className="d-flex align-items-center gap-1 small">
                    {icon}
                    {t(key)}
                  </li>
                ))}
              </ul>
              <p className="small fw-semibold mb-1">{t("submit.howTitle")}</p>
              <ul className="list-unstyled d-flex flex-wrap gap-2 mb-0">
                {FIX_STEPS.map(({ icon, key }) => (
                  <li key={key} className="fetch-fail-fix d-flex align-items-center gap-2 small">
                    {icon}
                    <span dir="auto">{t(key)}</span>
                  </li>
                ))}
              </ul>
            </Alert>
          )}

          {mode === "text" && (
            <TextPatternForm onResult={(result, originalUrl) => goToReview({ result, originalUrl })} />
          )}
          {mode === "photos" && (
            <PhotoPatternForm
              onResult={(result, originalUrl, photo) => goToReview({ result, originalUrl, photo })}
            />
          )}

          {mode === "link" && (
            <Form onSubmit={handleSubmit} className="mb-2" style={{ maxWidth: "32rem" }}>
              <Form.Group className="mb-3" controlId="submit-url">
                <Form.Label>{t("submit.urlLabel")}</Form.Label>
                <Form.Control
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={t("submit.urlPlaceholder")}
                  required
                />
              </Form.Group>
              <Button type="submit" variant="primary" disabled={loading}>
                {loading ? t("submit.fetching") : t("submit.previewButton")}
              </Button>
            </Form>
          )}
          {mode === "upload" && (
            <div className="mb-2" style={{ maxWidth: "32rem" }}>
              <p className="text-muted">{t("submit.uploadIntro")}</p>
              <Form onSubmit={handleUploadPreview}>
                <Form.Group className="mb-3" controlId="submit-upload-file">
                  <Form.Label>{t("submit.uploadFileLabel")}</Form.Label>
                  <Form.Control
                    type="file"
                    accept=".html,.htm,text/html,.pdf,application/pdf"
                    onChange={(e) =>
                      setUploadFile((e.target as HTMLInputElement).files?.[0] ?? null)
                    }
                    required
                  />
                </Form.Group>
                {/* A saved web page needs its link (credit + duplicate
                    check); a PDF often has no page at all, so for a PDF
                    it's optional and the author comes from the file. */}
                <Form.Group className="mb-3" controlId="submit-upload-url">
                  <Form.Label>{uploadIsPdf ? t("submit.sourceUrlLabel") : t("submit.urlLabel")}</Form.Label>
                  <Form.Control
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder={t("submit.urlPlaceholder")}
                    required={!uploadIsPdf}
                  />
                  <Form.Text>{uploadIsPdf ? t("submit.uploadPdfUrlHint") : t("submit.uploadUrlHint")}</Form.Text>
                </Form.Group>
                {uploadError && <Alert variant="danger">{uploadError}</Alert>}
                <Button type="submit" variant="primary" disabled={uploadLoading || !uploadFile}>
                  {uploadLoading ? t("submit.processing") : t("submit.uploadButton")}
                </Button>
              </Form>
            </div>
          )}

          <p className="text-muted">
            {t("submit.alreadyHaveIntro")} <Link to="/community">{t("submit.communityPage")}</Link>{" "}
            {t("submit.alreadyHaveTail")}
          </p>
        </>
      )}
    </div>
  );
}
