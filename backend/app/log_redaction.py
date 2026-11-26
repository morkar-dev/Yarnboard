"""
Keeps secrets out of every log line, as a safety net under the code's own
care (translation.py, for one, already strips the Gemini key from its
errors).

install() wraps the logging module's record factory, so it applies to
*every* logger -- Flask's app.logger, module loggers, gunicorn, werkzeug --
without touching handlers or formats. Each record's message, and the text
of any exception it carries (tracebacks included, chained "caused by"
exceptions too), has the current value of each secret env var replaced by
"<redacted ENV_NAME>". The database password is masked inside any
connection string as well.

Values are read from the environment on every record (cheap), so a secret
rotated at runtime or set by a test is still covered. Values shorter than
8 characters are ignored: masking a short, common string would mangle
ordinary log text and protect nothing.
"""

import logging
import os
import re
import traceback
from urllib.parse import urlsplit

SECRET_ENV_VARS = (
    "SECRET_KEY",
    "GEMINI_API_KEY",
    "RESEND_ONBOARDING",
    "RESEND_NOTIFICATIONS",
    "RESEND_NEWSLETTER",
    "PROXY_SHARED_SECRET",
    "DATABASE_URL",
)
MIN_SECRET_LENGTH = 8
# user:password@ inside any URL-looking string, whatever the database.
_URL_PASSWORD = re.compile(r"(\b[a-z][a-z0-9+.-]*://[^:/@\s]+:)[^@\s]+@", re.IGNORECASE)

_installed = False


def _secret_values() -> list[tuple[str, str]]:
    found = []
    for name in SECRET_ENV_VARS:
        value = os.environ.get(name) or ""
        if len(value) >= MIN_SECRET_LENGTH:
            found.append((name, value))
        if name == "DATABASE_URL" and value:
            password = urlsplit(value).password
            if password and len(password) >= MIN_SECRET_LENGTH:
                found.append(("DATABASE_URL password", password))
    # Longest first, so a value containing another is replaced whole.
    return sorted(found, key=lambda item: len(item[1]), reverse=True)


def redact(text: str) -> str:
    """`text` with every known secret value and any URL password masked."""
    for name, value in _secret_values():
        if value in text:
            text = text.replace(value, f"<redacted {name}>")
    return _URL_PASSWORD.sub(r"\1<redacted>@", text)


def install() -> None:
    """Idempotent: safe to call from every create_app()."""
    global _installed
    if _installed:
        return
    original_factory = logging.getLogRecordFactory()

    def redacting_factory(*args, **kwargs):
        record = original_factory(*args, **kwargs)
        try:
            message = record.getMessage()
        except Exception:  # a malformed format string: leave it to logging
            return record
        clean = redact(message)
        if clean != message:
            record.msg, record.args = clean, None
        if record.exc_info and record.exc_info[1] is not None:
            text = "".join(traceback.format_exception(*record.exc_info)).rstrip("\n")
            clean_text = redact(text)
            if clean_text != text:
                # Formatters use exc_text when it's already set, so the raw
                # traceback is never formatted again.
                record.exc_text = clean_text
        return record

    logging.setLogRecordFactory(redacting_factory)
    _installed = True
