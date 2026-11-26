"""Product-update newsletter: opt-in, unsubscribe, and admin sending."""

import pytest
import requests

import app.email as email_module
from app.extensions import db
from app.models import NewsletterIssue, User
from app.newsletter import routes as newsletter_routes


def _make_user(app, username, *, verified=True, admin=False, subscribed=None):
    with app.app_context():
        user = User(
            username=username,
            email=f"{username}@test.com",
            password_hash="x",
            email_verified=verified,
            is_admin=admin,
            notification_settings=None if subscribed is None else {"newsletter": {"email": subscribed}},
        )
        db.session.add(user)
        db.session.commit()
        return user.id


def _login_as(client, user_id):
    with client.session_transaction() as session:
        session["user_id"] = user_id


@pytest.fixture()
def sent(monkeypatch):
    """Captures newsletter batch calls instead of reaching Resend."""
    calls = []

    class _FakeResponse:
        def raise_for_status(self):
            pass

    def fake_post(url, headers, json, timeout):
        calls.append({"url": url, "emails": json})
        return _FakeResponse()

    monkeypatch.setenv("RESEND_NEWSLETTER", "test-key")
    monkeypatch.setattr(email_module.requests, "post", fake_post)
    return calls


def _all_recipients(calls):
    return [e["to"][0] for call in calls for e in call["emails"]]


# --- Opting in and out ------------------------------------------------------

def test_newsletter_is_off_until_the_user_turns_it_on(client, app):
    user_id = _make_user(app, "jane")
    _login_as(client, user_id)

    assert client.get("/api/newsletter/subscription").get_json() == {"subscribed": False}

    resp = client.put("/api/newsletter/subscription", json={"subscribed": True})

    assert resp.get_json() == {"subscribed": True}
    assert client.get("/api/newsletter/subscription").get_json() == {"subscribed": True}


def test_turning_it_on_keeps_other_notification_settings(client, app):
    user_id = _make_user(app, "jane")
    _login_as(client, user_id)
    client.patch("/api/notification-settings", json={"pattern_shared": {"email": False}})

    client.put("/api/newsletter/subscription", json={"subscribed": True})

    assert client.get("/api/notification-settings").get_json()["pattern_shared"]["email"] is False


def test_subscription_needs_login(client):
    assert client.get("/api/newsletter/subscription").status_code == 401
    assert client.put("/api/newsletter/subscription", json={"subscribed": True}).status_code == 401


def test_unsubscribe_link_works_without_login(client, app):
    user_id = _make_user(app, "jane", subscribed=True)
    with app.app_context():
        token = newsletter_routes.unsubscribe_token(User.query.get(user_id))

    resp = client.post(f"/api/newsletter/unsubscribe?token={token}")

    assert resp.status_code == 200
    with app.app_context():
        assert newsletter_routes.is_subscribed(User.query.get(user_id)) is False


def test_unsubscribe_rejects_a_forged_token(client, app):
    _make_user(app, "jane", subscribed=True)
    forged = newsletter_routes.URLSafeSerializer("wrong-secret", salt="newsletter-unsubscribe").dumps({"u": 1})

    resp = client.post("/api/newsletter/unsubscribe", json={"token": forged})

    assert resp.status_code == 400
    assert resp.get_json()["code"] == "invalid_unsubscribe_token"


# --- Sending ------------------------------------------------------------------

def test_only_admins_can_use_the_newsletter_page(client, app):
    _login_as(client, _make_user(app, "jane"))
    body = {"subject": "Hi", "body": "News", "expected_count": 0}

    for method, path in [("get", "/api/admin/newsletter"), ("post", "/api/admin/newsletter/preview"),
                         ("post", "/api/admin/newsletter/test"), ("post", "/api/admin/newsletter/send")]:
        assert getattr(client, method)(path, json=body).status_code == 403


def test_send_reaches_only_verified_subscribers(client, app, sent):
    admin_id = _make_user(app, "admin", admin=True)
    _make_user(app, "yes1", subscribed=True)
    _make_user(app, "yes2", subscribed=True)
    _make_user(app, "no", subscribed=False)
    _make_user(app, "never")
    _make_user(app, "unverified", verified=False, subscribed=True)
    _login_as(client, admin_id)

    assert client.get("/api/admin/newsletter").get_json() == {"subscriber_count": 2}
    resp = client.post("/api/admin/newsletter/send", json={"subject": "New: photos", "body": "Hello", "expected_count": 2})

    assert resp.get_json()["sent"] == 2
    assert sorted(_all_recipients(sent)) == ["yes1@test.com", "yes2@test.com"]
    email = sent[0]["emails"][0]
    assert email["subject"] == "New: photos"
    assert "/unsubscribe?token=" in email["html"]
    assert email["headers"]["List-Unsubscribe"].startswith("<") and "/api/newsletter/unsubscribe?token=" in email["headers"]["List-Unsubscribe"]


def test_send_refuses_when_the_confirmed_count_is_stale(client, app, sent):
    admin_id = _make_user(app, "admin", admin=True)
    _make_user(app, "yes1", subscribed=True)
    _login_as(client, admin_id)

    resp = client.post("/api/admin/newsletter/send", json={"subject": "Hi", "body": "News", "expected_count": 5})

    assert resp.status_code == 409
    assert resp.get_json()["subscriber_count"] == 1
    assert sent == []


def test_send_goes_out_in_batches_of_100(client, app, sent):
    admin_id = _make_user(app, "admin", admin=True)
    for i in range(130):
        _make_user(app, f"user{i}", subscribed=True)
    _login_as(client, admin_id)

    resp = client.post("/api/admin/newsletter/send", json={"subject": "Hi", "body": "News", "expected_count": 130})

    assert resp.get_json()["sent"] == 130
    assert [len(call["emails"]) for call in sent] == [100, 30]
    assert all(call["url"] == email_module.RESEND_BATCH_URL for call in sent)


def test_test_send_goes_only_to_the_admin(client, app, sent):
    admin_id = _make_user(app, "admin", admin=True)
    _make_user(app, "yes1", subscribed=True)
    _login_as(client, admin_id)

    resp = client.post("/api/admin/newsletter/test", json={"subject": "Hi", "body": "News"})

    assert resp.get_json() == {"sent_to": "admin@test.com"}
    assert _all_recipients(sent) == ["admin@test.com"]
    assert sent[0]["emails"][0]["subject"] == "[Test] Hi"


def test_a_failed_send_says_so(client, app, monkeypatch):
    admin_id = _make_user(app, "admin", admin=True)
    _make_user(app, "yes1", subscribed=True)
    _login_as(client, admin_id)
    monkeypatch.setenv("RESEND_NEWSLETTER", "test-key")

    def failing_post(*args, **kwargs):
        raise requests.ConnectionError("down")

    monkeypatch.setattr(email_module.requests, "post", failing_post)

    resp = client.post("/api/admin/newsletter/send", json={"subject": "Hi", "body": "News", "expected_count": 1})

    assert resp.status_code == 502
    assert resp.get_json()["code"] == "newsletter_send_failed"


def test_empty_newsletter_is_rejected(client, app):
    _login_as(client, _make_user(app, "admin", admin=True))

    resp = client.post("/api/admin/newsletter/preview", json={"subject": " ", "body": "News"})

    assert resp.status_code == 400
    assert resp.get_json()["code"] == "newsletter_empty"


# --- Public Updates page ----------------------------------------------------

def test_a_sent_newsletter_appears_on_the_updates_page(client, app, sent):
    admin_id = _make_user(app, "admin", admin=True)
    _make_user(app, "yes1", subscribed=True)
    _login_as(client, admin_id)

    first = client.post("/api/admin/newsletter/send", json={"subject": "Photos", "body": "Upload photos.", "expected_count": 1})
    second = client.post("/api/admin/newsletter/send", json={"subject": "Hebrew", "body": "Now in Hebrew.", "expected_count": 1})
    with client.session_transaction() as session:
        session.clear()

    updates = client.get("/api/updates").get_json()["updates"]

    assert [u["subject"] for u in updates] == ["Hebrew", "Photos"]
    assert updates[0]["id"] == second.get_json()["update_id"]
    assert updates[1]["id"] == first.get_json()["update_id"]
    assert updates[0]["body"] == "Now in Hebrew."
    assert updates[0]["sent_at"]
    # Nothing about who sent it or to how many.
    assert set(updates[0]) == {"id", "subject", "body", "sent_at"}


def test_test_sends_and_previews_are_not_published(client, app, sent):
    _login_as(client, _make_user(app, "admin", admin=True))

    client.post("/api/admin/newsletter/test", json={"subject": "Hi", "body": "News"})
    client.post("/api/admin/newsletter/preview", json={"subject": "Hi", "body": "News"})

    assert client.get("/api/updates").get_json() == {"updates": []}


def test_a_send_that_fails_partway_is_not_published(client, app, monkeypatch):
    admin_id = _make_user(app, "admin", admin=True)
    _make_user(app, "yes1", subscribed=True)
    _login_as(client, admin_id)
    monkeypatch.setenv("RESEND_NEWSLETTER", "test-key")

    def failing_post(*args, **kwargs):
        raise requests.ConnectionError("down")

    monkeypatch.setattr(email_module.requests, "post", failing_post)
    client.post("/api/admin/newsletter/send", json={"subject": "Hi", "body": "News", "expected_count": 1})

    assert client.get("/api/updates").get_json() == {"updates": []}


def test_a_refused_send_stores_nothing(client, app, sent):
    _login_as(client, _make_user(app, "admin", admin=True))
    _make_user(app, "yes1", subscribed=True)

    client.post("/api/admin/newsletter/send", json={"subject": "Hi", "body": "News", "expected_count": 7})

    with app.app_context():
        assert NewsletterIssue.query.count() == 0


def test_newsletter_footer_links_to_all_updates(monkeypatch):
    monkeypatch.setenv("PUBLIC_APP_URL", "https://www.yarnboard.net")

    html = email_module.newsletter_html("Hello", "https://www.yarnboard.net/unsubscribe?token=t")

    assert 'href="https://www.yarnboard.net/updates"' in html


# --- Rendering ----------------------------------------------------------------

def test_body_is_escaped_with_paragraphs_and_links():
    rendered = email_module.render_newsletter_body(
        "New this week!\nPhotos work again.\n\nSee https://yarnboard.net/community <b>now</b>"
    )

    assert rendered == (
        "<p>New this week!<br>Photos work again.</p>\n"
        '<p>See <a href="https://yarnboard.net/community">https://yarnboard.net/community</a> &lt;b&gt;now&lt;/b&gt;</p>'
    )


def test_javascript_links_are_not_linked():
    rendered = email_module.render_newsletter_body("javascript:alert(1)")

    assert "<a" not in rendered
