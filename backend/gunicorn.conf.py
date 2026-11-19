"""Gunicorn settings, picked up automatically by `gunicorn wsgi:app` run
from this directory (render.yaml's startCommand, or the same command set in
Render's dashboard) -- no --config flag needed.

The default 30s timeout is too short for /api/patterns/preview: a headless
browser launch plus a slow or bot-protected page can approach it, and a
worker killed at the limit returns a bare HTML 500 instead of the friendly
scraper_error JSON. The scraper keeps itself well under this (see
scraper.PAGE_LOAD_TIMEOUT_MS / CHALLENGE_WAIT_MS); this is the safety net,
and stays under Cloudflare's 100s proxy limit in front of Render.
"""

timeout = 90
