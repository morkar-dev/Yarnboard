/**
 * The site's landing page -- first thing any visitor sees at "/",
 * logged in or not (see App.tsx's "/" route, unguarded on purpose, and
 * LoginPage's post-login navigate back here). A hero line plus four icon
 * tiles for the four things there are to do here, each linking straight
 * to the page that does it, and a three-step "how it works" strip.
 * Deliberately light on text -- one short line per tile; the pages
 * themselves explain the details. Not a feature in itself, just
 * onboarding; nothing here is fetched from the API.
 */
import type { ReactNode } from "react";
import { Card, Col, Row } from "react-bootstrap";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ChecklistIcon, GridIcon, LinkIcon, PencilIcon, YarnIllustration } from "../components/Icons";
import { useAuth } from "../context/AuthContext";

interface Guide {
  icon: ReactNode;
  titleKey: string;
  descriptionKey: string;
  linkTo: string;
  ctaKey: string;
}

const GUIDES: Guide[] = [
  {
    icon: <LinkIcon size={28} />,
    titleKey: "home.submitTitle",
    descriptionKey: "home.submitDescription",
    linkTo: "/submit",
    ctaKey: "home.submitCta",
  },
  {
    icon: <ChecklistIcon size={28} />,
    titleKey: "home.useTitle",
    descriptionKey: "home.useDescription",
    linkTo: "/community",
    ctaKey: "home.useCta",
  },
  {
    icon: <GridIcon size={28} />,
    titleKey: "home.stitchFiddleTitle",
    descriptionKey: "home.stitchFiddleDescription",
    linkTo: "/stitch-fiddle",
    ctaKey: "home.stitchFiddleCta",
  },
  {
    icon: <PencilIcon size={28} />,
    titleKey: "home.editTitle",
    descriptionKey: "home.editDescription",
    linkTo: "/mine",
    ctaKey: "home.editCta",
  },
];

const STEPS: { icon: ReactNode; labelKey: string }[] = [
  { icon: <LinkIcon size={22} />, labelKey: "home.step1" },
  { icon: <PencilIcon size={22} />, labelKey: "home.step2" },
  { icon: <ChecklistIcon size={22} />, labelKey: "home.step3" },
];

export default function HomePage() {
  const { user } = useAuth();
  const { t } = useTranslation();

  return (
    <>
      <div className="d-flex align-items-center gap-4 mb-4 home-hero">
        <div className="flex-grow-1">
          <h1 className="mb-2">{user ? t("home.welcomeNamed", { username: user.username }) : t("home.welcome")}</h1>
          <p className="lead text-muted mb-3">{t("home.subtitle")}</p>
          <ol className="home-steps list-unstyled d-flex flex-wrap align-items-center gap-2 mb-0">
            {STEPS.map((step, i) => (
              <li key={step.labelKey} className="d-flex align-items-center gap-2">
                <span className="home-step-icon">{step.icon}</span>
                <span className="fw-semibold">{t(step.labelKey)}</span>
                {i < STEPS.length - 1 && (
                  <span className="text-muted home-step-arrow" aria-hidden="true">
                    →
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
        <div className="d-none d-sm-block flex-shrink-0">
          <YarnIllustration size={150} />
        </div>
      </div>

      <Row xs={1} sm={2} lg={4} className="g-3">
        {GUIDES.map((guide) => (
          <Col key={guide.titleKey}>
            <Card className="h-100 shadow-sm text-center home-tile">
              <Card.Body className="d-flex flex-column align-items-center gap-2">
                <span className="home-tile-icon">{guide.icon}</span>
                <Card.Title as="h2" className="h6 mb-0">
                  {t(guide.titleKey)}
                </Card.Title>
                <Card.Text className="small text-muted flex-grow-1 mb-1">{t(guide.descriptionKey)}</Card.Text>
                <Link to={guide.linkTo} className="btn btn-outline-primary btn-sm stretched-link">
                  {t(guide.ctaKey)}
                </Link>
              </Card.Body>
            </Card>
          </Col>
        ))}
      </Row>
    </>
  );
}
