"""Adding a pattern from pasted text (POST /api/patterns/preview-text) or
from photos read by Gemini (POST /api/patterns/preview-photos), and saving
one with no source link. Gemini is always mocked -- these tests never make
a network call."""

import base64
import io

import pytest
from PIL import Image

from app import transcription
from app.extensions import db
from app.models import User
from app.scraper import parse_pattern_text
from app.translation import TranslationError

STRUCTURED_TEXT = """Cozy Beanie
Designed by Jane Doe

Materials:
- Drops Air, 2 skeins
- 4mm needles

Abbreviations:
k = knit

Brim:
1. Cast on 96.
2. Rows 1-8: k2, p2.

# Crown
Knit to end.
"""


def _register_and_login(client, username="maker"):
    email = f"{username}@test.com"
    client.post("/api/register", json={"username": username, "email": email, "password": "password123"})
    with client.application.app_context():
        user = User.query.filter_by(email=email).first()
        user.email_verified = True
        db.session.commit()
    client.post("/api/login", json={"email": email, "password": "password123"})


def _jpeg(color=(200, 100, 150)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (40, 30), color).save(buffer, format="JPEG")
    return buffer.getvalue()


def _photo_form(count=1, url=None):
    data = {"photos": [(io.BytesIO(_jpeg()), f"page{i}.jpg") for i in range(count)]}
    if url is not None:
        data["url"] = url
    return data


# --- parse_pattern_text --------------------------------------------------


def test_text_parser_splits_sections_parts_and_author():
    draft = parse_pattern_text(STRUCTURED_TEXT)
    assert draft["title"] == "Cozy Beanie"
    assert draft["author"] == "Jane Doe"
    assert draft["materials"] == "- Drops Air, 2 skeins\n- 4mm needles"
    assert draft["abbreviations"] == "k = knit"
    assert draft["instructions"] == {
        "Brim": ["Cast on 96.", "Rows 1-8: k2, p2."],
        "Crown": ["Knit to end."],
    }
    assert draft["source_domain"] is None


def test_text_parser_turns_bare_steps_into_one_checklist():
    draft = parse_pattern_text("Simple Scarf\nCast on 20.\nKnit every row.\nBind off.")
    assert draft["title"] == "Simple Scarf"
    assert draft["instructions"] == {"Instructions": ["Cast on 20.", "Knit every row.", "Bind off."]}


def test_text_parser_keeps_all_caps_material_lines_in_materials():
    draft = parse_pattern_text("Hat\nMaterials:\nDROPS AIR\n4mm needles\nInstructions:\nCast on.")
    assert draft["materials"] == "DROPS AIR\n4mm needles"


def test_text_parser_uses_the_source_url_domain_when_given():
    draft = parse_pattern_text(STRUCTURED_TEXT, "https://www.example.com/beanie")
    assert draft["source_domain"] == "example.com"


# --- POST /api/patterns/preview-text ---------------------------------------


def test_preview_text_requires_login(client):
    resp = client.post("/api/patterns/preview-text", json={"text": STRUCTURED_TEXT})
    assert resp.status_code == 401


def test_preview_text_returns_a_draft(client):
    _register_and_login(client)
    resp = client.post("/api/patterns/preview-text", json={"text": STRUCTURED_TEXT})
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["duplicate"] is False
    assert body["draft"]["title"] == "Cozy Beanie"
    assert list(body["draft"]["instructions"]) == ["Brim", "Crown"]


@pytest.mark.parametrize(
    ("payload", "code"),
    [
        ({"text": "   "}, "text_required"),
        ({"text": "x" * 50_001}, "text_too_long"),
        ({"text": STRUCTURED_TEXT, "url": "javascript:alert(1)"}, "invalid_source_url"),
    ],
)
def test_preview_text_rejects_bad_input(client, payload, code):
    _register_and_login(client)
    resp = client.post("/api/patterns/preview-text", json=payload)
    assert resp.status_code == 400
    assert resp.get_json()["code"] == code


def test_preview_text_with_an_already_saved_url_points_at_the_existing_pattern(client):
    _register_and_login(client)
    saved = client.post(
        "/api/patterns/submit",
        json={"original_url": "https://example.com/beanie", "title": "Beanie", "instructions": {}},
    ).get_json()["pattern"]
    resp = client.post("/api/patterns/preview-text", json={"text": STRUCTURED_TEXT, "url": "https://example.com/beanie"})
    body = resp.get_json()
    assert body["duplicate"] is True
    assert body["existing_pattern_id"] == saved["id"]


# --- POST /api/patterns/preview-photos -------------------------------------


def test_preview_photos_reads_the_photos_into_a_draft(client, monkeypatch):
    _register_and_login(client)
    received = {}

    def fake_transcribe(images):
        received["count"] = len(images)
        received["are_jpegs"] = all(img[:2] == b"\xff\xd8" for img in images)
        return STRUCTURED_TEXT

    monkeypatch.setattr(transcription, "transcribe_pattern_photos", fake_transcribe)
    resp = client.post("/api/patterns/preview-photos", data=_photo_form(2), content_type="multipart/form-data")

    assert resp.status_code == 200
    assert resp.get_json()["draft"]["title"] == "Cozy Beanie"
    assert received == {"count": 2, "are_jpegs": True}


def test_preview_photos_requires_login(client):
    resp = client.post("/api/patterns/preview-photos", data=_photo_form(), content_type="multipart/form-data")
    assert resp.status_code == 401


@pytest.mark.parametrize(
    ("form", "code"),
    [
        ({}, "photos_required"),
        ({"photos": [(io.BytesIO(_jpeg()), f"p{i}.jpg") for i in range(6)]}, "too_many_photos"),
        ({"photos": [(io.BytesIO(b"not an image"), "p.jpg")]}, "invalid_photo"),
        ({"photos": [(io.BytesIO(_jpeg()), "p.jpg")], "url": "ftp://example.com"}, "invalid_source_url"),
    ],
)
def test_preview_photos_rejects_bad_input(client, monkeypatch, form, code):
    _register_and_login(client)
    monkeypatch.setattr(transcription, "transcribe_pattern_photos", lambda images: pytest.fail("Gemini called"))
    resp = client.post("/api/patterns/preview-photos", data=form, content_type="multipart/form-data")
    assert resp.status_code == 400
    assert resp.get_json()["code"] == code


def test_preview_photos_gemini_failure_is_friendly_and_doesnt_leak_details(client, monkeypatch):
    _register_and_login(client)

    def boom(images):
        raise TranslationError("GEMINI_API_KEY is not set -- cannot translate. See README for setup.")

    monkeypatch.setattr(transcription, "transcribe_pattern_photos", boom)
    resp = client.post("/api/patterns/preview-photos", data=_photo_form(), content_type="multipart/form-data")
    body = resp.get_json()
    assert resp.status_code == 502
    assert body["code"] == "photo_read_error"
    assert "GEMINI" not in body["error"]


def test_preview_photos_with_no_readable_text(client, monkeypatch):
    _register_and_login(client)
    monkeypatch.setattr(transcription, "transcribe_pattern_photos", lambda images: "")
    resp = client.post("/api/patterns/preview-photos", data=_photo_form(), content_type="multipart/form-data")
    assert resp.status_code == 422
    assert resp.get_json()["code"] == "photo_no_text"


def test_transcription_sends_each_photo_to_gemini_as_inline_jpeg(monkeypatch):
    """With only Gemini configured, each photo goes to it as an inline JPEG
    part, with the {"text"} schema."""
    import json as _json

    from app import translation

    captured = {}

    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {"candidates": [{"content": {"parts": [{"text": _json.dumps({"text": "  Hat\nCast on.  "})}]}}]}

    def fake_post(url, headers, json, timeout):
        captured["url"] = url
        captured["body"] = json
        return FakeResponse()

    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key")
    monkeypatch.setattr(translation.requests, "post", fake_post)
    images = [_jpeg(), _jpeg((0, 0, 0))]
    assert transcription.transcribe_pattern_photos(images) == "Hat\nCast on."
    parts = captured["body"]["contents"][0]["parts"][1:]
    assert "generativelanguage.googleapis.com" in captured["url"]
    assert [p["inline_data"]["mime_type"] for p in parts] == ["image/jpeg", "image/jpeg"]
    assert base64.b64decode(parts[1]["inline_data"]["data"]) == images[1]
    assert captured["body"]["generationConfig"]["responseSchema"]["required"] == ["text"]


# --- Saving without a source link -----------------------------------------


def test_submit_without_a_url_saves_a_pattern_with_no_source_link(client):
    _register_and_login(client)
    payload = {"title": "Grandma's Socks", "instructions": {"Instructions": ["Cast on 60."]}}

    first = client.post("/api/patterns/submit", json=payload)
    second = client.post("/api/patterns/submit", json=payload)

    assert first.status_code == 201
    assert second.status_code == 201  # no URL means nothing to deduplicate on
    pattern = first.get_json()["pattern"]
    assert pattern["has_source_link"] is False
    assert pattern["original_url"].startswith("manual:")
    assert pattern["source_domain"] is None


def test_submit_with_a_url_still_has_a_source_link(client):
    _register_and_login(client)
    pattern = client.post(
        "/api/patterns/submit",
        json={"original_url": "https://example.com/hat", "title": "Hat", "instructions": {}},
    ).get_json()["pattern"]
    assert pattern["has_source_link"] is True


@pytest.mark.parametrize("bad_url", [
    "javascript:alert(document.cookie)",
    "JavaScript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "manual:00000000-0000-0000-0000-000000000000",
    "example.com/hat",
])
def test_submit_rejects_a_source_link_that_isnt_http(client, bad_url):
    """The pattern page renders original_url as a link, so only http(s)
    may be stored -- and a user-supplied "manual:" value must not pass for
    the no-source placeholder."""
    _register_and_login(client)
    resp = client.post(
        "/api/patterns/submit",
        json={"original_url": bad_url, "title": "Hat", "instructions": {}},
    )
    assert resp.status_code == 400
    assert resp.get_json()["code"] == "invalid_source_url"


def test_submit_still_requires_a_title(client):
    _register_and_login(client)
    resp = client.post("/api/patterns/submit", json={"original_url": "", "title": " "})
    assert resp.status_code == 400
