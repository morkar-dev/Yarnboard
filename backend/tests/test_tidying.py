"""Community search (GET /api/patterns/community?q=), clearing a user's
checklist progress (DELETE /api/patterns/<id>/progress), the scraper
keeping source links on materials lines, and the friendly scraper error."""

from app.extensions import db
from app.models import User
from app.scraper import parse_pattern_html


def _register_and_login(client, username):
    email = f"{username}@test.com"
    client.post(
        "/api/register",
        json={"username": username, "email": email, "password": "password123"},
    )
    with client.application.app_context():
        user = User.query.filter_by(email=email).first()
        user.email_verified = True
        db.session.commit()
    client.post("/api/login", json={"email": email, "password": "password123"})


def _publish(client, title, url, author=None):
    pattern = client.post(
        "/api/patterns/submit",
        json={
            "original_url": url,
            "title": title,
            "author": author,
            "instructions": {"Body": ["Cast on 10.", "Knit 2 rows."]},
        },
    ).get_json()["pattern"]
    client.post(f"/api/patterns/{pattern['id']}/publish")
    return pattern["id"]


def test_community_search_matches_title_and_author_case_insensitively(client):
    _register_and_login(client, "owner")
    _publish(client, "Cozy Beanie", "https://example.com/a")
    _publish(client, "Granny Square Blanket", "https://example.com/b", author="Ann Beanstalk")
    _publish(client, "Plain Socks", "https://example.com/c")

    titles = {p["title"] for p in client.get("/api/patterns/community?q=bean").get_json()}
    assert titles == {"Cozy Beanie", "Granny Square Blanket"}

    all_titles = {p["title"] for p in client.get("/api/patterns/community?q=").get_json()}
    assert len(all_titles) == 3


def test_community_search_treats_like_wildcards_literally(client):
    _register_and_login(client, "owner")
    _publish(client, "Plain Socks", "https://example.com/c")
    assert client.get("/api/patterns/community?q=%25").get_json() == []


def test_clear_progress_unchecks_every_step(client):
    _register_and_login(client, "owner")
    pattern_id = _publish(client, "Cozy Beanie", "https://example.com/a")
    for index in (0, 1):
        client.patch(
            f"/api/patterns/{pattern_id}/progress",
            json={"part": "Body", "index": index, "completed": True},
        )

    resp = client.delete(f"/api/patterns/{pattern_id}/progress")
    assert resp.status_code == 200

    steps = client.get(f"/api/patterns/{pattern_id}").get_json()["instructions"]["Body"]
    assert [s["completed"] for s in steps] == [False, False]


def test_clear_progress_requires_login(client):
    resp = client.delete("/api/patterns/1/progress")
    assert resp.status_code == 401


def test_scraper_keeps_links_on_materials_only():
    html = """
    <html><body><article>
      <h1>Cozy Beanie</h1>
      <h2>Materials</h2>
      <ul>
        <li>Yarn: <a href="/shop/drops-air">Drops Air</a>, 2 skeins</li>
        <li>4mm needles</li>
      </ul>
      <h2>Instructions</h2>
      <ol><li>Cast on with the <a href="https://example.com/tutorial">long-tail method</a>.</li></ol>
    </article></body></html>
    """
    draft = parse_pattern_html(html, "https://example.com/beanie")

    assert draft["materials"].splitlines() == [
        "Yarn: [Drops Air](https://example.com/shop/drops-air), 2 skeins",
        "4mm needles",
    ]
    assert draft["instructions"]["Instructions"] == ["Cast on with the long-tail method."]


def test_scraper_failure_returns_a_friendly_message(client):
    _register_and_login(client, "owner")
    resp = client.post("/api/patterns/preview", json={"url": "http://127.0.0.1/"})
    assert resp.status_code == 502
    body = resp.get_json()
    assert body["code"] == "scraper_error"
    assert "127.0.0.1" not in body["error"]
