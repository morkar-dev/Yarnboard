"""Secret env values never reach a log line or traceback (app/log_redaction.py)."""

import logging

import pytest

from app import log_redaction

DB_URL = "postgresql+psycopg2://owner:npg_SuperSecret123@ep-test-pooler.neon.tech/neondb?sslmode=require"


@pytest.fixture(autouse=True)
def secrets(monkeypatch):
    log_redaction.install()
    monkeypatch.setenv("GEMINI_API_KEY", "AIza-gemini-secret-value")
    monkeypatch.setenv("RESEND_NEWSLETTER", "re_newsletter_secret_value")
    monkeypatch.setenv("PROXY_SHARED_SECRET", "proxy-shared-secret-value")
    monkeypatch.setenv("DATABASE_URL", DB_URL)


def test_secret_values_in_a_message_are_masked(caplog):
    logger = logging.getLogger("app.anything")
    with caplog.at_level(logging.INFO):
        logger.warning("calling https://x.test/?key=%s with %s", "AIza-gemini-secret-value", "re_newsletter_secret_value")

    assert "AIza-gemini-secret-value" not in caplog.text
    assert "re_newsletter_secret_value" not in caplog.text
    assert "<redacted GEMINI_API_KEY>" in caplog.text
    assert "<redacted RESEND_NEWSLETTER>" in caplog.text


def test_database_url_and_its_password_are_masked(caplog):
    with caplog.at_level(logging.INFO):
        logging.getLogger("app").error("could not connect: %s", DB_URL)
        logging.getLogger("app").error("password=npg_SuperSecret123 rejected")

    assert "npg_SuperSecret123" not in caplog.text


def test_any_url_password_is_masked_even_if_not_an_env_value():
    assert log_redaction.redact("postgres://someone:hunter2hunter2@db.example/x") == (
        "postgres://someone:<redacted>@db.example/x"
    )


def test_tracebacks_and_chained_exceptions_are_masked(caplog):
    logger = logging.getLogger("app.anything")
    with caplog.at_level(logging.INFO):
        try:
            try:
                raise ValueError("upstream said: proxy-shared-secret-value is wrong")
            except ValueError as inner:
                raise RuntimeError("wrapped") from inner
        except RuntimeError:
            logger.exception("request failed")

    assert "proxy-shared-secret-value" not in caplog.text
    assert "<redacted PROXY_SHARED_SECRET>" in caplog.text
    assert "wrapped" in caplog.text


def test_ordinary_messages_are_untouched(caplog):
    with caplog.at_level(logging.INFO):
        logging.getLogger("app").info("Newsletter %r sent to %d subscriber(s)", "Photos", 3)

    assert "Newsletter 'Photos' sent to 3 subscriber(s)" in caplog.text


def test_install_is_idempotent():
    factory = logging.getLogRecordFactory()
    log_redaction.install()
    assert logging.getLogRecordFactory() is factory
