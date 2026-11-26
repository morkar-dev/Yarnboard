"""
Product-update newsletter: users opt in from Notification settings (off
by default -- marketing email needs prior consent), an admin writes and
sends it from the admin page, and every email has a one-click
unsubscribe link that works without logging in.

The opt-in lives in User.notification_settings under "newsletter"
({"email": bool}), next to the per-pattern notification toggles, so no
schema change is needed. Each send is stored as a NewsletterIssue and,
once it has gone out, shown to everyone on the public Updates page
(GET /api/updates, the frontend's /updates).
"""

from datetime import datetime, timezone

import requests
from flask import Blueprint, current_app, jsonify, request
from itsdangerous import BadSignature, URLSafeSerializer

from ..email import newsletter_html, send_newsletter_batch
from ..extensions import db, limiter
from ..models import NewsletterIssue, User
from ..utils import get_current_user_id

newsletter_bp = Blueprint("newsletter", __name__, url_prefix="/api")

MAX_SUBJECT_LENGTH = 150
MAX_BODY_LENGTH = 20_000


def is_subscribed(user: User) -> bool:
    return bool((user.notification_settings or {}).get("newsletter", {}).get("email", False))


def set_subscribed(user: User, value: bool) -> None:
    settings = dict(user.notification_settings or {})
    settings["newsletter"] = {"email": bool(value)}
    user.notification_settings = settings


def subscribers() -> list[User]:
    """Verified accounts that turned the newsletter on. Filtered in Python:
    the opt-in sits inside a JSON column, and the user table is small."""
    return [u for u in User.query.filter_by(email_verified=True).order_by(User.id) if is_subscribed(u)]


def _serializer() -> URLSafeSerializer:
    return URLSafeSerializer(current_app.config["SECRET_KEY"], salt="newsletter-unsubscribe")


def unsubscribe_token(user: User) -> str:
    return _serializer().dumps({"u": user.id})


def _current_user():
    user_id = get_current_user_id()
    return User.query.get(user_id) if user_id else None


def _require_login():
    user = _current_user()
    if not user:
        return None, (jsonify({"error": "Unauthorized", "code": "unauthorized"}), 401)
    return user, None


def _require_admin():
    user, error = _require_login()
    if error:
        return None, error
    if not user.is_admin:
        return None, (jsonify({"error": "Only admins can send newsletters.", "code": "forbidden"}), 403)
    return user, None


def _read_newsletter():
    """(subject, body, error_response) from the request body."""
    data = request.get_json(silent=True) or {}
    subject = (data.get("subject") or "").strip()
    body = (data.get("body") or "").strip()
    if not subject or not body:
        return None, None, (jsonify({"error": "Write a subject and a message first.", "code": "newsletter_empty"}), 400)
    if len(subject) > MAX_SUBJECT_LENGTH or len(body) > MAX_BODY_LENGTH:
        return None, None, (jsonify({
            "error": f"Keep the subject under {MAX_SUBJECT_LENGTH} characters and the message under {MAX_BODY_LENGTH}.",
            "code": "newsletter_too_long",
        }), 400)
    return subject, body, None


# ---- Subscribers ----------------------------------------------------------

@newsletter_bp.route("/newsletter/subscription", methods=["GET"])
def get_subscription():
    """Whether the logged-in user gets product update emails."""
    user, error = _require_login()
    if error:
        return error
    return jsonify({"subscribed": is_subscribed(user)}), 200


@newsletter_bp.route("/newsletter/subscription", methods=["PUT"])
def update_subscription():
    """Turn product update emails on or off: body {"subscribed": bool}."""
    user, error = _require_login()
    if error:
        return error
    data = request.get_json(silent=True) or {}
    if not isinstance(data.get("subscribed"), bool):
        return jsonify({"error": "subscribed must be true or false.", "code": "missing_fields"}), 400
    set_subscribed(user, data["subscribed"])
    db.session.commit()
    return jsonify({"subscribed": is_subscribed(user)}), 200


@newsletter_bp.route("/newsletter/unsubscribe", methods=["POST"])
@limiter.limit("30/hour")
def unsubscribe():
    """
    Unsubscribe with the token from a newsletter email, no login needed.
    The token comes in the query string (mail apps' one-click
    List-Unsubscribe POST) or the JSON body (the /unsubscribe page).
    """
    token = request.args.get("token") or (request.get_json(silent=True) or {}).get("token") or ""
    try:
        user_id = _serializer().loads(token)["u"]
    except (BadSignature, KeyError, TypeError):
        return jsonify({
            "error": "This unsubscribe link isn't valid. Log in and turn off product updates in Notification settings.",
            "code": "invalid_unsubscribe_token",
        }), 400
    user = User.query.get(user_id)
    if user:
        set_subscribed(user, False)
        db.session.commit()
    return jsonify({"unsubscribed": True}), 200


# ---- Admin ----------------------------------------------------------------

@newsletter_bp.route("/admin/newsletter", methods=["GET"])
def newsletter_status():
    """How many people a send would reach right now."""
    _, error = _require_admin()
    if error:
        return error
    return jsonify({"subscriber_count": len(subscribers())}), 200


@newsletter_bp.route("/admin/newsletter/preview", methods=["POST"])
def preview_newsletter():
    """The email body exactly as subscribers will get it (minus their
    personal unsubscribe link)."""
    _, error = _require_admin()
    if error:
        return error
    subject, body, error = _read_newsletter()
    if error:
        return error
    return jsonify({"subject": subject, "html": newsletter_html(body, "#unsubscribe")}), 200


@newsletter_bp.route("/admin/newsletter/test", methods=["POST"])
def send_test_newsletter():
    """Send the newsletter only to the admin who's writing it."""
    admin, error = _require_admin()
    if error:
        return error
    subject, body, error = _read_newsletter()
    if error:
        return error
    try:
        send_newsletter_batch(f"[Test] {subject}", body, [(admin.email, unsubscribe_token(admin))])
    except requests.RequestException as exc:
        current_app.logger.error("Newsletter test send failed: %s", exc)
        return jsonify({"error": "The test email couldn't be sent. Try again in a moment.", "code": "newsletter_send_failed"}), 502
    return jsonify({"sent_to": admin.email}), 200


@newsletter_bp.route("/admin/newsletter/send", methods=["POST"])
def send_newsletter():
    """
    Send to every subscriber. `expected_count` must match the current
    subscriber count -- the number the admin confirmed on the page -- so
    a send never reaches a different audience than the one confirmed.
    """
    admin, error = _require_admin()
    if error:
        return error
    subject, body, error = _read_newsletter()
    if error:
        return error

    recipients = subscribers()
    expected = (request.get_json(silent=True) or {}).get("expected_count")
    if expected != len(recipients):
        return jsonify({
            "error": "The number of subscribers changed. Check the new number and confirm again.",
            "code": "subscriber_count_changed",
            "subscriber_count": len(recipients),
        }), 409
    if not recipients:
        return jsonify({"error": "Nobody has turned on product updates yet.", "code": "no_subscribers"}), 400

    # Stored first (unpublished): if the table is missing or the write
    # fails, nothing has been emailed yet.
    issue = NewsletterIssue(subject=subject, body=body, sent_by_id=admin.id)
    db.session.add(issue)
    db.session.commit()

    try:
        sent = send_newsletter_batch(subject, body, [(u.email, unsubscribe_token(u)) for u in recipients])
    except requests.RequestException as exc:
        current_app.logger.error("Newsletter %r (issue %d) failed partway: %s", subject, issue.id, exc)
        return jsonify({
            "error": "Sending stopped partway. Check the server log before sending again, so nobody gets it twice.",
            "code": "newsletter_send_failed",
        }), 502

    issue.published = True
    issue.recipient_count = sent
    issue.sent_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.session.commit()
    current_app.logger.info("Newsletter %r sent to %d subscriber(s) by %s", subject, sent, admin.username)
    return jsonify({"sent": sent, "update_id": issue.id}), 200


@newsletter_bp.route("/updates", methods=["GET"])
def list_updates():
    """
    The public Updates page: every newsletter that went out, newest first.
    No login needed.
    ---
    tags: [Newsletter]
    responses:
      200:
        description: "{updates: [{id, subject, body, sent_at}]}"
    """
    issues = (
        NewsletterIssue.query.filter_by(published=True)
        .order_by(NewsletterIssue.sent_at.desc(), NewsletterIssue.id.desc())
        .all()
    )
    return jsonify({"updates": [issue.to_public_dict() for issue in issues]}), 200
