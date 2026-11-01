import { useState, type FormEvent } from "react";
import { Alert, Button, Card, Col, Form, InputGroup, Row } from "react-bootstrap";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { CheckIcon, CircleIcon, EyeIcon, EyeOffIcon } from "../components/Icons";
import { useAuth } from "../context/AuthContext";
import { useApiErrorMessage } from "../i18n/useApiErrorMessage";

// Mirrors backend/app/auth/routes.py's register() checks, so a bad value
// is caught while typing instead of on submit. The server still enforces
// all of these on its own.
const USERNAME_MAX_LENGTH = 30;
const MIN_PASSWORD_LENGTH = 8;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function passwordRules(password: string) {
  return [
    { key: "auth.register.ruleLength", ok: password.length >= MIN_PASSWORD_LENGTH },
    { key: "auth.register.ruleLetter", ok: /\p{L}/u.test(password) },
    { key: "auth.register.ruleNumber", ok: /\d/.test(password) },
  ];
}

export default function RegisterPage() {
  const { register } = useAuth();
  const { t } = useTranslation();
  const getErrorMessage = useApiErrorMessage();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // Validation messages only appear once the user has tried to submit,
  // so the form doesn't open already covered in red.
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Set once registration succeeds -- there's no session to navigate into
  // (the account starts unverified), so this page shows a confirmation
  // instead of redirecting to /community.
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setAttempted(true);
    if (!formValid) return;
    setSubmitting(true);
    try {
      await register(username, email, password);
      setRegisteredEmail(email);
    } catch (err) {
      setError(getErrorMessage(err, t("auth.register.failed")));
    } finally {
      setSubmitting(false);
    }
  }

  const rules = passwordRules(password);
  const usernameValid = username.trim().length > 0 && username.trim().length <= USERNAME_MAX_LENGTH;
  const emailValid = EMAIL_RE.test(email.trim());
  const passwordValid = rules.every((r) => r.ok);
  const confirmValid = confirmPassword.length > 0 && confirmPassword === password;
  const formValid = usernameValid && emailValid && passwordValid && confirmValid;
  // Flag a mismatch as soon as the confirmation stops being a prefix of
  // the password (a typo, not just "still typing"), or on submit.
  const showConfirmMismatch =
    (attempted && !confirmValid) || (confirmPassword.length > 0 && !password.startsWith(confirmPassword));

  const toggleLabel = showPassword ? t("auth.register.hidePassword") : t("auth.register.showPassword");

  if (registeredEmail) {
    return (
      <Row className="justify-content-center">
        <Col xs={12} sm={8} md={5} lg={4}>
          <Card className="shadow-sm">
            <Card.Body>
              <Card.Title as="h1" className="h3 mb-4">
                {t("auth.register.checkEmailTitle")}
              </Card.Title>
              <p>{t("auth.register.checkEmailBody", { email: registeredEmail })}</p>
              <Link to="/login">{t("auth.register.goToLogin")}</Link>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    );
  }

  return (
    <Row className="justify-content-center">
      <Col xs={12} sm={8} md={5} lg={4}>
        <Card className="shadow-sm">
          <Card.Body>
            <Card.Title as="h1" className="h3 mb-4">
              {t("auth.register.title")}
            </Card.Title>
            <Form onSubmit={handleSubmit} noValidate>
              <Form.Group className="mb-3" controlId="register-username">
                <Form.Label>{t("auth.register.usernameLabel")}</Form.Label>
                <Form.Control
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  maxLength={USERNAME_MAX_LENGTH}
                  autoComplete="username"
                  isInvalid={attempted && !usernameValid}
                  required
                />
                <Form.Control.Feedback type="invalid">
                  {t("auth.register.usernameInvalid", { max: USERNAME_MAX_LENGTH })}
                </Form.Control.Feedback>
              </Form.Group>
              <Form.Group className="mb-3" controlId="register-email">
                <Form.Label>{t("auth.register.emailLabel")}</Form.Label>
                <Form.Control
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  isInvalid={attempted && !emailValid}
                  required
                />
                <Form.Control.Feedback type="invalid">{t("auth.register.emailInvalid")}</Form.Control.Feedback>
              </Form.Group>
              <Form.Group className="mb-2" controlId="register-password">
                <Form.Label>{t("auth.register.passwordLabel")}</Form.Label>
                <InputGroup hasValidation>
                  <Form.Control
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    isInvalid={attempted && !passwordValid}
                    aria-describedby="register-password-rules"
                    required
                  />
                  <Button
                    variant="outline-secondary"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={toggleLabel}
                    aria-pressed={showPassword}
                    title={toggleLabel}
                  >
                    {showPassword ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
                  </Button>
                </InputGroup>
              </Form.Group>
              <ul id="register-password-rules" className="list-unstyled small mb-3">
                {rules.map((rule) => (
                  <li
                    key={rule.key}
                    className={`d-flex align-items-center gap-1 ${
                      rule.ok ? "text-success" : attempted ? "text-danger" : "text-muted"
                    }`}
                  >
                    {rule.ok ? <CheckIcon size={14} /> : <CircleIcon size={14} />}
                    {t(rule.key, { min: MIN_PASSWORD_LENGTH })}
                  </li>
                ))}
              </ul>
              <Form.Group className="mb-3" controlId="register-password-confirm">
                <Form.Label>{t("auth.register.confirmPasswordLabel")}</Form.Label>
                <Form.Control
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  isInvalid={showConfirmMismatch}
                  required
                />
                <Form.Control.Feedback type="invalid">{t("auth.register.passwordsDontMatch")}</Form.Control.Feedback>
              </Form.Group>
              {error && <Alert variant="danger">{error}</Alert>}
              <Button type="submit" variant="primary" className="w-100" disabled={submitting}>
                {submitting ? t("auth.register.submitting") : t("auth.register.submit")}
              </Button>
            </Form>
          </Card.Body>
        </Card>
      </Col>
    </Row>
  );
}
