"""
translation._call_model's provider chain: Groq first when GROQ_API_KEY is
set, Gemini as the fallback (see translation.py). requests.post is faked
throughout -- no test talks to a real provider.
"""

import base64
import json
import logging

import pytest
import requests

from app import transcription, translation
from app.translation import TranslationError

GROQ_KEY = "gsk_test_groq_key_value"
GEMINI_KEY = "AIza-test-gemini-key"
# A complete translation answer: Groq's answers are checked against the schema.
PATTERN = {"title": "Hat", "materials": "", "abbreviations": "", "instructions": [{"heading": "Body", "steps": ["ch 4"]}]}


class FakeResponse:
    def __init__(self, status=200, payload=None):
        self.status_code = status
        self._payload = payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"{self.status_code} error", response=self)

    def json(self):
        return self._payload


def groq_answer(obj, wrap=lambda text: text):
    return FakeResponse(payload={"choices": [{"message": {"content": wrap(json.dumps(obj))}}]})


def gemini_answer(obj):
    return FakeResponse(payload={"candidates": [{"content": {"parts": [{"text": json.dumps(obj)}]}}]})


class Recorder:
    """Fake requests.post: answers each call with the next queued response
    (or raises it, for exceptions) and records what was sent."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls = []

    def __call__(self, url, headers, json, timeout):
        self.calls.append({"url": url, "headers": headers, "json": json, "timeout": timeout})
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response

    def providers(self):
        return ["groq" if "groq.com" in c["url"] else "gemini" for c in self.calls]


@pytest.fixture()
def both_keys(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", GROQ_KEY)
    monkeypatch.setenv("GEMINI_API_KEY", GEMINI_KEY)
    monkeypatch.setattr(translation, "RETRY_BACKOFF_SECONDS", 0)


def install(monkeypatch, recorder):
    monkeypatch.setattr(translation.requests, "post", recorder)
    return recorder


def test_groq_goes_first_with_a_bearer_key_and_strict_schema(both_keys, monkeypatch):
    rec = install(monkeypatch, Recorder(groq_answer({**PATTERN, "title": "כובע"})))

    assert translation._call_model("translate this") == {**PATTERN, "title": "כובע"}

    call = rec.calls[0]
    assert rec.providers() == ["groq"]
    assert call["headers"] == {"Authorization": f"Bearer {GROQ_KEY}"}
    assert GROQ_KEY not in call["url"]
    assert call["json"]["model"] == translation.GROQ_MODEL
    assert call["json"]["messages"] == [{"role": "user", "content": "translate this"}]
    fmt = call["json"]["response_format"]
    assert fmt["type"] == "json_schema" and fmt["json_schema"]["strict"] is True
    assert fmt["json_schema"]["schema"]["properties"]["instructions"]["items"]["required"] == ["heading", "steps"]
    assert call["timeout"] == translation.GROQ_ATTEMPT_SECONDS


def test_schema_conversion_lowercases_types_and_closes_objects():
    out = translation._to_json_schema(translation._RESPONSE_SCHEMA)

    assert out["type"] == "object"
    assert out["additionalProperties"] is False
    assert out["required"] == ["title", "materials", "abbreviations", "instructions"]
    item = out["properties"]["instructions"]["items"]
    assert item == {
        "type": "object",
        "properties": {"heading": {"type": "string"}, "steps": {"type": "array", "items": {"type": "string"}}},
        "required": ["heading", "steps"],
        "additionalProperties": False,
    }


def test_photos_go_to_groq_vision_as_data_urls_in_json_mode(both_keys, monkeypatch):
    rec = install(monkeypatch, Recorder(groq_answer({"text": " Hat\nCast on. "})))
    images = [b"\xff\xd8first", b"\xff\xd8second"]

    assert transcription.transcribe_pattern_photos(images) == "Hat\nCast on."

    body = rec.calls[0]["json"]
    assert body["model"] == translation.GROQ_VISION_MODEL
    assert body["response_format"] == {"type": "json_object"}
    content = body["messages"][0]["content"]
    assert content[0]["type"] == "text"
    urls = [part["image_url"]["url"] for part in content[1:]]
    assert urls == ["data:image/jpeg;base64," + base64.b64encode(image).decode("ascii") for image in images]


def test_more_photos_than_groq_takes_go_straight_to_gemini(both_keys, monkeypatch):
    rec = install(monkeypatch, Recorder(gemini_answer({"text": "Hat"})))

    transcription.transcribe_pattern_photos([b"a", b"b", b"c", b"d"])

    assert rec.providers() == ["gemini"]


@pytest.mark.parametrize("failure", [
    FakeResponse(429), FakeResponse(503), FakeResponse(401), FakeResponse(400),
    requests.Timeout("read timed out"),
    FakeResponse(payload={"choices": []}),
    FakeResponse(payload={"choices": [{"message": {"content": "not json at all"}}]}),
])
def test_any_groq_failure_falls_back_to_gemini(both_keys, monkeypatch, caplog, failure):
    rec = install(monkeypatch, Recorder(failure, gemini_answer({"title": "Hat"})))

    with caplog.at_level(logging.WARNING):
        assert translation._call_model("translate") == {"title": "Hat"}

    assert rec.providers() == ["groq", "gemini"]
    assert "trying gemini" in caplog.text
    assert GROQ_KEY not in caplog.text


def test_reasoning_and_code_fences_around_the_json_are_ignored(both_keys, monkeypatch):
    wrap = lambda text: f"<think>let me see {{draft}}</think>\n```json\n{text}\n```"
    install(monkeypatch, Recorder(groq_answer(PATTERN, wrap)))

    assert translation._call_model("translate") == PATTERN


def test_ai_providers_gemini_skips_groq(both_keys, monkeypatch):
    monkeypatch.setenv("AI_PROVIDERS", "gemini")
    rec = install(monkeypatch, Recorder(gemini_answer({"title": "Hat"})))

    translation._call_model("translate")

    assert rec.providers() == ["gemini"]


def test_groq_alone_retries_busy_answers_then_succeeds(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", GROQ_KEY)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setattr(translation, "RETRY_BACKOFF_SECONDS", 0)
    rec = install(monkeypatch, Recorder(FakeResponse(429), FakeResponse(503), groq_answer(PATTERN)))

    assert translation._call_model("translate") == PATTERN
    assert rec.providers() == ["groq", "groq", "groq"]
    assert rec.calls[0]["timeout"] == translation.REQUEST_TIMEOUT_SECONDS


def test_groq_alone_fails_fast_on_a_bad_key_without_leaking_it(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", GROQ_KEY)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    install(monkeypatch, Recorder(requests.HTTPError(f"401 for key {GROQ_KEY}", response=FakeResponse(401))))

    with pytest.raises(TranslationError) as info:
        translation._call_model("translate")

    assert "Groq API request failed" in str(info.value)
    assert GROQ_KEY not in str(info.value)


def test_both_failing_raises_gemini_error(both_keys, monkeypatch):
    install(monkeypatch, Recorder(FakeResponse(503), FakeResponse(400)))

    with pytest.raises(TranslationError, match="Gemini API request failed"):
        translation._call_model("translate")


def test_after_a_slow_groq_gemini_still_reaches_its_lite_model(both_keys, monkeypatch):
    """Groq uses its whole attempt, then Gemini's main model times out too:
    the main model's attempt is capped so the lite model still gets one."""
    now = {"t": 1000.0}
    monkeypatch.setattr(translation, "_monotonic", lambda: now["t"])
    calls = []

    def post(url, headers, json, timeout):
        calls.append((url, timeout))
        if "groq.com" in url or translation.GEMINI_MODEL in url:
            now["t"] += timeout
            raise requests.Timeout("slow")
        return gemini_answer({"title": "Hat"})

    monkeypatch.setattr(translation.requests, "post", post)

    assert translation._call_model("translate") == {"title": "Hat"}

    left_for_gemini = translation.TOTAL_BUDGET_SECONDS - translation.GROQ_ATTEMPT_SECONDS
    primary_limit = min(translation.PRIMARY_ATTEMPT_SECONDS, left_for_gemini - translation.MIN_ATTEMPT_SECONDS)
    assert [timeout for _, timeout in calls] == [
        translation.GROQ_ATTEMPT_SECONDS, primary_limit, left_for_gemini - primary_limit,
    ]
    assert translation.GEMINI_FALLBACK_MODEL in calls[2][0]


def test_groq_photo_answer_with_the_wrong_shape_falls_back_to_gemini(both_keys, monkeypatch):
    rec = install(monkeypatch, Recorder(groq_answer({}), gemini_answer({"text": "Hat"})))

    assert transcription.transcribe_pattern_photos([b"a"]) == "Hat"
    assert rec.providers() == ["groq", "gemini"]


def test_gemini_first_hands_over_to_groq_when_it_fails(both_keys, monkeypatch):
    monkeypatch.setenv("AI_PROVIDERS", "gemini,groq")
    rec = install(monkeypatch, Recorder(FakeResponse(400), groq_answer(PATTERN)))

    assert translation._call_model("translate") == PATTERN
    assert rec.providers() == ["gemini", "groq"]


def test_groq_alone_refuses_more_photos_than_it_takes_without_calling_it(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", GROQ_KEY)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    rec = install(monkeypatch, Recorder())

    with pytest.raises(TranslationError, match="up to 3 photos"):
        transcription.transcribe_pattern_photos([b"a", b"b", b"c", b"d"])
    assert rec.calls == []


def test_no_provider_configured(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    with pytest.raises(TranslationError, match="No AI provider is configured"):
        translation._call_model("translate")
