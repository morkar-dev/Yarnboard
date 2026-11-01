"""
Shared Flask extension instances.

These are instantiated here (without an app attached) and bound to the real
app later inside create_app() via extension.init_app(app). Keeping them in
their own module -- instead of creating them directly in __init__.py --
lets models.py and scraper.py import `db`/`bcrypt` without importing
app/__init__.py itself, which would otherwise create a circular import
(__init__.py needs models.py to create tables, models.py needs `db`).
"""

import hmac

from flask import current_app, request
from flask_sqlalchemy import SQLAlchemy
from flask_bcrypt import Bcrypt
from flask_limiter import Limiter

db = SQLAlchemy()
bcrypt = Bcrypt()

# In-memory storage (the default) is fine for this app's single-service,
# low-traffic deployment -- it resets on restart and isn't shared across
# worker processes, which is an acceptable tradeoff here since the goal is
# blunting casual brute-force/credential-stuffing/email-bombing attempts,
# not perfect enforcement. Default limits are applied per-route below
# (see auth/routes.py) rather than globally, since most routes don't need
# throttling as tightly as login/register do.
def client_ip() -> str:
    """
    The visitor's real IP, for per-IP rate limiting. In production every
    request reaches Flask through at least one proxy, so request.remote_addr
    alone is the proxy's address and would put all users in one bucket:

    1. Through the Cloudflare Worker (worker/index.js): the Worker sends
       Cloudflare's CF-Connecting-IP as X-Yarnboard-Client-IP, trusted only
       alongside the right PROXY_SHARED_SECRET -- anyone can send the
       header straight to Render, but not the secret.
    2. Straight to Render: Render appends the connecting address as the
       last X-Forwarded-For entry. Earlier entries are client-supplied and
       forgeable, the last one isn't.
    3. Neither (local dev, tests): remote_addr.
    """
    secret = current_app.config.get("PROXY_SHARED_SECRET", "")
    forwarded_ip = request.headers.get("X-Yarnboard-Client-IP", "").strip()
    sent_secret = request.headers.get("X-Yarnboard-Proxy-Secret", "")
    # Compared as bytes: compare_digest raises TypeError on non-ASCII str,
    # and Werkzeug hands headers over latin-1-decoded -- a junk header would
    # otherwise turn /api/login into a 500.
    if secret and forwarded_ip and hmac.compare_digest(sent_secret.encode("utf-8"), secret.encode("utf-8")):
        return forwarded_ip

    forwarded_for = request.headers.get("X-Forwarded-For", "")
    if forwarded_for:
        last = forwarded_for.split(",")[-1].strip()
        if last:
            return last

    return request.remote_addr or "127.0.0.1"


limiter = Limiter(key_func=client_ip)
