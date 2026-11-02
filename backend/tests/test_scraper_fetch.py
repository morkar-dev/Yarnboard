"""_fetch_html's handling of bot-detection challenges and bad responses,
with Playwright replaced by a fake browser -- no real browser or network.

The regression this guards: a challenge page that never cleared used to be
waited on long enough (page load + a hard-coded 20s wait) that gunicorn
killed the request at its 30s limit, so the user got a bare 500 instead of
the friendly scraper_error.
"""

import time

import pytest

from app import scraper
from app.scraper import ScraperError, _fetch_html

CHALLENGE_TITLE = "Just a moment..."


class FakeResponse:
    def __init__(self, status):
        self.status = status
        self.ok = 200 <= status < 300


class FakeLocator:
    def __init__(self, page):
        self.page = page

    def inner_text(self, timeout=None):
        return self.page.current()[1]


class FakePage:
    """`frames` is the sequence of (title, body) the page shows on each
    look -- the last one repeats -- so a challenge can clear after N checks."""

    def __init__(self, status, frames):
        self.status = status
        self.frames = list(frames)
        self.looks = 0

    def current(self):
        return self.frames[min(self.looks, len(self.frames) - 1)]

    def route(self, pattern, handler):
        pass

    def goto(self, url, timeout=None, wait_until=None):
        return FakeResponse(self.status)

    def title(self):
        self.looks += 1
        return self.frames[min(self.looks - 1, len(self.frames) - 1)][0]

    def locator(self, selector):
        return FakeLocator(self)

    def wait_for_timeout(self, ms):
        pass

    def content(self):
        return f"<html><title>{self.current()[0]}</title></html>"


class FakePlaywright:
    def __init__(self, page):
        self.chromium = self
        self.page = page

    def launch(self):
        return self

    def new_page(self, user_agent=None):
        return self.page

    def close(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@pytest.fixture
def fake_browser(monkeypatch):
    monkeypatch.setattr(scraper, "_guard_request_url", lambda url: None)
    monkeypatch.setattr(scraper, "CHALLENGE_WAIT_MS", 50)

    def install(status, frames):
        page = FakePage(status, frames)
        monkeypatch.setattr(scraper, "sync_playwright", lambda: FakePlaywright(page))
        return page

    return install


def test_a_challenge_that_never_clears_fails_fast_with_the_upload_hint(fake_browser):
    fake_browser(403, [(CHALLENGE_TITLE, "Checking your browser")])
    start = time.monotonic()
    with pytest.raises(ScraperError, match="bot-detection.*file upload"):
        _fetch_html("https://blocked.example.com/pattern")
    assert time.monotonic() - start < 1


def test_a_challenge_that_clears_returns_the_real_page(fake_browser):
    # Challenge on the first two looks, then the real page -- even though
    # the original response was the challenge's 403.
    fake_browser(403, [(CHALLENGE_TITLE, "")] * 2 + [("Unicorn Pattern", "Cast on 6.")])
    assert "Unicorn Pattern" in _fetch_html("https://slow.example.com/pattern")


def test_a_normal_error_status_is_reported_unwrapped(fake_browser):
    fake_browser(404, [("Not found", "No such page")])
    with pytest.raises(ScraperError) as exc_info:
        _fetch_html("https://example.com/missing")
    assert str(exc_info.value) == "https://example.com/missing returned HTTP 404"


def test_a_page_that_mentions_cloudflare_in_its_footer_is_not_a_challenge(fake_browser):
    fake_browser(200, [("Cozy Hat", "Cast on 80. Performance & security by Cloudflare")])
    assert "Cozy Hat" in _fetch_html("https://example.com/hat")


def test_the_scrape_budget_stays_under_gunicorns_timeout():
    from pathlib import Path

    config = {}
    exec((Path(__file__).parents[1] / "gunicorn.conf.py").read_text(), config)
    worst_case_s = (scraper.PAGE_LOAD_TIMEOUT_MS + scraper.CHALLENGE_WAIT_MS) / 1000
    assert worst_case_s + 15 < config["timeout"]  # room for browser launch etc.
