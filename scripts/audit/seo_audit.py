"""
Checks the fixable items from the Yarnboard Speed & SEO audit (PageSpeed
Insights, GTmetrix and SEOptimer, Oct 2026) against a running site -- the
live one by default, or a local build (see the Makefile's `audit-local`).

Each check prints PASS / FAIL / WARN / SKIP with a one-line reason, and the
script exits non-zero if anything FAILs, so it can gate a deploy. Browser-
only checks (console errors, Lighthouse CLS and scores) live next door in
frontend/scripts/audit-browser.mjs. Items that need a human (unused JS/CSS
treemaps, the SSR/hreflang decision, share-preview validators) are listed
at the end rather than faked.

Standard library only -- runs with any python3, no venv needed.

Usage:
    python3 scripts/audit/seo_audit.py [URL] [--env=main|dev] [--local]

--env=dev (the dev Worker on workers.dev) skips the HTTPS-redirect and
SPF/DMARC checks, since workers.dev is Cloudflare's domain, not ours. --local skips everything that only
makes sense on a real deployment (HTTP->HTTPS redirect, HSTS, SPF/DMARC).
"""

from __future__ import annotations

import http.client
import json
import os
import re
import ssl
import subprocess
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9"
ROBOTS_FIELDS = {"user-agent", "allow", "disallow", "sitemap", "crawl-delay", "host"}
USER_AGENT = "yarnboard-audit/1.0"

results: list[tuple[str, str, str, str]] = []  # (status, area, check, detail)


def _ssl_context() -> ssl.SSLContext:
    """python.org's macOS Python ships without root certificates (until its
    "Install Certificates.command" is run), so every https request fails
    verification. Fall back to certifi, then macOS's own bundle."""
    context = ssl.create_default_context()
    if context.cert_store_stats().get("x509_ca"):
        return context
    try:
        import certifi  # noqa: PLC0415 -- optional

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        pass
    if os.path.exists("/etc/ssl/cert.pem"):
        return ssl.create_default_context(cafile="/etc/ssl/cert.pem")
    return context


SSL_CONTEXT = _ssl_context()


def record(status: str, area: str, check: str, detail: str = "") -> None:
    results.append((status, area, check, detail))


def fetch(url: str) -> tuple[int, dict[str, str], bytes]:
    """GET `url` following redirects; returns (status, lower-cased headers, body)."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=20, context=SSL_CONTEXT) as resp:
            return resp.status, {k.lower(): v for k, v in resp.headers.items()}, resp.read()
    except urllib.error.HTTPError as exc:
        return exc.code, {k.lower(): v for k, v in exc.headers.items()}, exc.read()


def looks_like_html(body: bytes, headers: dict[str, str]) -> bool:
    """The SPA fallback answers any unknown path with index.html -- the
    original robots.txt/llms.txt bug -- so a "200" alone proves nothing."""
    return "text/html" in headers.get("content-type", "") or body.lstrip()[:15].lower().startswith(
        (b"<!doctype", b"<html")
    )


class HeadParser(HTMLParser):
    """Collects the <head> bits the SEO checks need."""

    def __init__(self) -> None:
        super().__init__()
        self.title = ""
        self._in_title = False
        self.meta: dict[str, str] = {}
        self.links: list[dict[str, str]] = []
        self.scripts: list[dict[str, str]] = []
        self.json_ld: list[str] = []
        self._in_json_ld = False

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "title":
            self._in_title = True
        elif tag == "meta":
            key = a.get("name") or a.get("property")
            if key:
                self.meta[key.lower()] = a.get("content", "")
        elif tag == "link":
            self.links.append(a)
        elif tag == "script":
            self.scripts.append(a)
            if a.get("type", "").lower() == "application/ld+json":
                self._in_json_ld = True
                self.json_ld.append("")

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        elif tag == "script":
            self._in_json_ld = False

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        if self._in_json_ld:
            self.json_ld[-1] += data


# --- SEO ---------------------------------------------------------------


def check_head(base: str, head: HeadParser) -> None:
    desc = head.meta.get("description", "").strip()
    if not desc:
        record("FAIL", "SEO", "Meta description", "no <meta name=\"description\">")
    elif not 50 <= len(desc) <= 160:
        record("WARN", "SEO", "Meta description", f"{len(desc)} chars (aim for 50-160)")
    else:
        record("PASS", "SEO", "Meta description", f"{len(desc)} chars")

    title = head.title.strip()
    if 50 <= len(title) <= 60:
        record("PASS", "SEO", "Title length", f"{len(title)} chars: {title!r}")
    else:
        record("FAIL", "SEO", "Title length", f"{len(title)} chars (aim for 50-60): {title!r}")

    canonical = next((l.get("href", "") for l in head.links if "canonical" in l.get("rel", "").lower().split()), "")
    if not canonical:
        record("FAIL", "SEO", "Canonical tag", "no <link rel=\"canonical\">")
    elif not canonical.startswith("https://"):
        record("FAIL", "SEO", "Canonical tag", f"should be an absolute https URL: {canonical}")
    else:
        record("PASS", "SEO", "Canonical tag", canonical)

    social = ["og:title", "og:description", "og:image", "og:url", "twitter:card"]
    missing = [tag for tag in social if not head.meta.get(tag)]
    if missing:
        record("FAIL", "SEO", "Open Graph / X card tags", "missing " + ", ".join(missing))
    else:
        record("PASS", "SEO", "Open Graph / X card tags", "all present")

    if not head.json_ld:
        record("FAIL", "SEO", "Schema.org JSON-LD", "no <script type=\"application/ld+json\">")
    else:
        types: list[str] = []
        for block in head.json_ld:
            try:
                data = json.loads(block)
            except ValueError as exc:
                record("FAIL", "SEO", "Schema.org JSON-LD", f"invalid JSON: {exc}")
                break
            items = data if isinstance(data, list) else data.get("@graph", [data])
            for item in items:
                t = item.get("@type") if isinstance(item, dict) else None
                types.extend(t if isinstance(t, list) else [t] if t else [])
        else:
            wanted = {"WebSite", "Organization"}
            if wanted & set(types):
                record("PASS", "SEO", "Schema.org JSON-LD", "types: " + ", ".join(types))
            else:
                record("FAIL", "SEO", "Schema.org JSON-LD", f"no WebSite/Organization type (found {types or 'none'})")


def check_robots(base: str) -> None:
    status, headers, body = fetch(urljoin(base, "/robots.txt"))
    if status != 200:
        record("FAIL", "SEO", "robots.txt", f"HTTP {status}")
        return
    if looks_like_html(body, headers):
        record("FAIL", "SEO", "robots.txt", "served the SPA's index.html, not a real file")
        return
    errors, has_agent, has_sitemap = [], False, False
    for n, raw in enumerate(body.decode("utf-8", "replace").splitlines(), 1):
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        field, sep, value = line.partition(":")
        field = field.strip().lower()
        if not sep or field not in ROBOTS_FIELDS:
            errors.append(f"line {n}: {raw.strip()[:40]!r}")
            continue
        has_agent |= field == "user-agent"
        if field == "sitemap":
            has_sitemap = True
            if not value.strip().startswith("https://"):
                errors.append(f"line {n}: Sitemap must be an absolute https URL")
    if errors:
        record("FAIL", "SEO", "robots.txt", "; ".join(errors[:3]) + (" ..." if len(errors) > 3 else ""))
    elif not has_agent:
        record("FAIL", "SEO", "robots.txt", "no User-agent line")
    elif not has_sitemap:
        record("WARN", "SEO", "robots.txt", "valid, but no Sitemap: line pointing crawlers at sitemap.xml")
    else:
        record("PASS", "SEO", "robots.txt", "valid directives, Sitemap line present")


def check_sitemap(base: str) -> None:
    status, headers, body = fetch(urljoin(base, "/sitemap.xml"))
    if status != 200:
        record("FAIL", "SEO", "sitemap.xml", f"HTTP {status}")
        return
    if looks_like_html(body, headers):
        record("FAIL", "SEO", "sitemap.xml", "served the SPA's index.html, not a real file")
        return
    try:
        root = ET.fromstring(body)
    except ET.ParseError as exc:
        record("FAIL", "SEO", "sitemap.xml", f"not well-formed XML: {exc}")
        return
    if root.tag != f"{{{SITEMAP_NS}}}urlset":
        record("FAIL", "SEO", "sitemap.xml", f"root must be <urlset xmlns=\"{SITEMAP_NS}\">, got {root.tag}")
        return
    locs = [el.text.strip() for el in root.iter(f"{{{SITEMAP_NS}}}loc") if el.text]
    if not locs:
        record("FAIL", "SEO", "sitemap.xml", "no <url><loc> entries")
        return
    bad = [loc for loc in locs if not loc.startswith("https://")]
    if bad:
        record("FAIL", "SEO", "sitemap.xml", f"{len(bad)} <loc> not https, e.g. {bad[0]}")
    else:
        record("PASS", "SEO", "sitemap.xml", f"{len(locs)} URLs")


def check_https_redirect(base: str) -> None:
    host = urlparse(base).hostname
    conn = http.client.HTTPConnection(host, 80, timeout=15)
    try:
        conn.request("GET", "/", headers={"User-Agent": USER_AGENT})
        resp = conn.getresponse()
        location = resp.getheader("Location", "")
    except OSError as exc:
        record("FAIL", "SEO", "HTTP -> HTTPS redirect", f"plain http request failed: {exc}")
        return
    finally:
        conn.close()
    if resp.status in (301, 308) and location.startswith("https://"):
        record("PASS", "SEO", "HTTP -> HTTPS redirect", f"{resp.status} -> {location}")
    elif resp.status in (302, 307) and location.startswith("https://"):
        record("WARN", "SEO", "HTTP -> HTTPS redirect", f"temporary {resp.status}; prefer 301/308")
    else:
        record("FAIL", "SEO", "HTTP -> HTTPS redirect", f"http://{host}/ answered {resp.status} without redirecting to https (Cloudflare: Always Use HTTPS)")


def dig_txt(name: str) -> list[str]:
    try:
        out = subprocess.run(["dig", "+short", "TXT", name], capture_output=True, text=True, timeout=15).stdout
    except (OSError, subprocess.TimeoutExpired):
        return []
    return [line.replace('" "', "").strip('"') for line in out.splitlines()]


def check_mail_dns(base: str) -> None:
    host = urlparse(base).hostname or ""
    domain = host[4:] if host.startswith("www.") else host
    spf = [r for r in dig_txt(domain) if r.lower().startswith("v=spf1")]
    record("PASS" if spf else "FAIL", "SEO", "SPF record", spf[0] if spf else f"no v=spf1 TXT record on {domain}")
    dmarc = [r for r in dig_txt(f"_dmarc.{domain}") if r.lower().startswith("v=dmarc1")]
    record("PASS" if dmarc else "FAIL", "SEO", "DMARC record", dmarc[0] if dmarc else f"no v=DMARC1 TXT record on _dmarc.{domain}")


# --- Performance -------------------------------------------------------


def check_performance(base: str, head: HeadParser) -> None:
    stylesheets = [l for l in head.links if "stylesheet" in l.get("rel", "").lower().split()]
    if stylesheets:
        record("PASS", "Performance", "CSS linked in initial HTML (CLS fix)", ", ".join(l.get("href", "") for l in stylesheets))
    else:
        record("FAIL", "Performance", "CSS linked in initial HTML (CLS fix)", "no <link rel=stylesheet> -- CSS loads only after JS runs, which shifts the layout")

    asset = next(
        (l.get("href") for l in stylesheets if l.get("href", "").startswith("/assets/")),
        next((s.get("src") for s in head.scripts if s.get("src", "").startswith("/assets/")), None),
    )
    if not asset:
        record("SKIP", "Performance", "Static asset cache policy", "no /assets/* file referenced in index.html (unbuilt dev server?)")
        return
    _, headers, _ = fetch(urljoin(base, asset))
    cache = headers.get("cache-control", "")
    match = re.search(r"max-age=(\d+)", cache)
    if match and int(match.group(1)) >= 31536000 and "immutable" in cache:
        record("PASS", "Performance", "Static asset cache policy", f"{asset}: {cache}")
    else:
        record("FAIL", "Performance", "Static asset cache policy", f"{asset}: Cache-Control is {cache or 'missing'!r} (want max-age=31536000, immutable)")


# --- Best Practices ----------------------------------------------------


def check_security_headers(headers: dict[str, str], local: bool) -> None:
    csp = headers.get("content-security-policy", "")
    record("PASS" if csp else "FAIL", "Best Practices", "Content-Security-Policy", csp[:80] or "missing")
    if local:
        record("SKIP", "Best Practices", "Strict-Transport-Security", "only meaningful over real HTTPS")
    else:
        hsts = headers.get("strict-transport-security", "")
        m = re.search(r"max-age=(\d+)", hsts)
        if m and int(m.group(1)) >= 31536000:
            record("PASS", "Best Practices", "Strict-Transport-Security", hsts)
        else:
            record("FAIL", "Best Practices", "Strict-Transport-Security", hsts or "missing (want max-age >= 31536000)")
    coop = headers.get("cross-origin-opener-policy", "")
    record("PASS" if coop else "FAIL", "Best Practices", "Cross-Origin-Opener-Policy", coop or "missing")
    xfo = headers.get("x-frame-options", "")
    if xfo or "frame-ancestors" in csp:
        record("PASS", "Best Practices", "Clickjacking protection", xfo or "CSP frame-ancestors")
    else:
        record("FAIL", "Best Practices", "Clickjacking protection", "no X-Frame-Options or CSP frame-ancestors")


# --- Agentic Browsing --------------------------------------------------


def check_agentic(base: str) -> None:
    status, headers, body = fetch(urljoin(base, "/llms.txt"))
    if status != 200:
        record("FAIL", "Agentic", "llms.txt", f"HTTP {status}")
    elif looks_like_html(body, headers):
        record("FAIL", "Agentic", "llms.txt", "served the SPA's index.html, not a real file")
    elif not body.decode("utf-8", "replace").lstrip().startswith("# "):
        record("FAIL", "Agentic", "llms.txt", "should start with a '# Site name' heading (llmstxt.org format)")
    else:
        record("PASS", "Agentic", "llms.txt", "real markdown file")

    status, headers, body = fetch(urljoin(base, "/ai-catalog.json"))
    if status != 200:
        record("FAIL", "Agentic", "ai-catalog.json", f"HTTP {status}")
    elif looks_like_html(body, headers):
        record("FAIL", "Agentic", "ai-catalog.json", "served the SPA's index.html, not a real file")
    else:
        try:
            data = json.loads(body)
            ok = isinstance(data, dict) and bool(data)
            record("PASS" if ok else "FAIL", "Agentic", "ai-catalog.json", "valid JSON object" if ok else "must be a non-empty JSON object")
        except ValueError as exc:
            record("FAIL", "Agentic", "ai-catalog.json", f"invalid JSON: {exc}")


MANUAL = [
    "Unused JavaScript (~55 KiB) and legacy JavaScript: open the Lighthouse report's Treemap (frontend/audit-report.report.html after `make audit`) and name the heavy modules.",
    "Unused CSS (~30 KiB): needs a trimmed Bootstrap build -- a design decision, not a pass/fail check.",
    "Non-composited animations: record a DevTools Performance trace of the home page and read off the flagged elements.",
    "SSR / prerendering and hreflang per-language routes: an architecture decision.",
    "Share previews: paste the live URL into Facebook's Sharing Debugger and X's Card Validator; JSON-LD into Google's Rich Results Test.",
]

COLORS = {"PASS": "\033[32m", "FAIL": "\033[31m", "WARN": "\033[33m", "SKIP": "\033[90m"}


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    local = "--local" in sys.argv
    env = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--env=")), "main")
    base = (args[0] if args else "https://www.yarnboard.net").rstrip("/") + "/"

    try:
        status, headers, body = fetch(base)
    except urllib.error.URLError as exc:
        print(f"Couldn't reach {base}: {exc.reason}")
        return 2
    if status != 200:
        print(f"{base} answered HTTP {status} -- is the site up?")
        return 2
    head = HeadParser()
    head.feed(body.decode("utf-8", "replace"))

    check_head(base, head)
    check_robots(base)
    check_sitemap(base)
    if local:
        record("SKIP", "SEO", "HTTP -> HTTPS redirect", "local run")
        record("SKIP", "SEO", "SPF / DMARC records", "local run")
    elif env == "dev":
        record("SKIP", "SEO", "HTTP -> HTTPS redirect", "dev Worker -- workers.dev's redirects are Cloudflare's, not ours")
        record("SKIP", "SEO", "SPF / DMARC records", "dev Worker -- workers.dev isn't our mail domain")
    else:
        check_https_redirect(base)
        check_mail_dns(base)
    check_performance(base, head)
    check_security_headers(headers, local)
    check_agentic(base)

    color = sys.stdout.isatty()
    label = "local build" if local else env
    print(f"\nYarnboard speed & SEO audit ({label}) -- {base}\n")
    area = None
    for status_, area_, check, detail in results:
        if area_ != area:
            area = area_
            print(f"  {area}")
        tag = f"{COLORS[status_]}{status_}\033[0m" if color else status_
        print(f"    {tag}  {check}" + (f" -- {detail}" if detail else ""))

    counts = {s: sum(1 for r in results if r[0] == s) for s in COLORS}
    print(f"\n  {counts['PASS']} passed, {counts['FAIL']} failed, {counts['WARN']} warnings, {counts['SKIP']} skipped")
    print("\n  Still needs a human:")
    for item in MANUAL:
        print(f"    - {item}")
    print()
    return 1 if counts["FAIL"] else 0


if __name__ == "__main__":
    sys.exit(main())
