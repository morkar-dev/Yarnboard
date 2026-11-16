"""
Best-effort heuristic extraction of pattern content from arbitrary
knitting/crochet webpages.

There is no standard markup for pattern pages across the web (blogs,
Ravelry, PDF-behind-a-page sites, etc. all structure "materials",
"abbreviations" and "instructions" differently), so this module does NOT
try to be a fully general, guaranteed-correct parser. Instead it makes a
reasonable first pass using heading keywords and common list markup, and
the result is always shown to the user as an *editable draft* before
anything is saved (see the preview/submit split in patterns/routes.py).
Treat every field this module returns as a suggestion, not ground truth.
"""

import copy
import io
import ipaddress
import re
import socket
import time
import zlib
from urllib.parse import unquote, urljoin, urlparse

import pdfplumber
from bs4 import BeautifulSoup

from playwright.sync_api import (
    Page,
    TimeoutError as PlaywrightTimeoutError,
    sync_playwright,
)

USER_AGENT = (
    "Mozilla/5.0 (compatible; YarnboardBot/1.0; "
    "+https://github.com/yarnboard) pattern-preview"
)
REQUEST_TIMEOUT_SECONDS = 10

# A PDF text line counts as "bold" (PDF's equivalent of an HTML label tag)
# if at least this fraction of its characters are rendered in a
# bold-named font (e.g. "Helvetica-Bold", "AAAAAA+Times-Bold" -- the
# "AAAAAA+" is a common font-subsetting prefix, harmless to the substring
# check). Not 100%: a bold line can still contain the occasional
# non-bold character (kerning artifacts, embedded symbols) without that
# meaning the line as a whole isn't a label.
PDF_BOLD_LINE_RATIO = 0.6

# Tags that always count as a section/part label if their own text is short
# enough (h1 excluded -- that's the page title, handled by _extract_title,
# and titles routinely contain words like "pattern" which would otherwise
# false-match a materials/abbreviations keyword).
ALWAYS_LABEL_TAGS = ("h2", "h3", "h4", "h5", "h6", "strong", "b")
# Tags that only count as a label when they're styled bold -- very common
# on older/simpler pattern blogs (e.g. classic Blogger templates), which
# often have *no* real heading markup at all: the whole post is one flat
# run of text and <br> tags, with section names marked only by
# `<span style="font-weight: bold;">Materials:</span>`-style inline styling.
MAYBE_BOLD_LABEL_TAGS = ("span", "font", "div", "p")
# Tags whose content should end on its own line when the page is
# linearized into plain text (see _linearize). <br> is handled separately
# since it has no content of its own to append a newline after.
BLOCK_LEVEL_TAGS = ("p", "li", "div", "tr", "h1", "h2", "h3", "h4", "h5", "h6")
# A label longer than this is almost certainly a real sentence that happens
# to be bold, not a section name -- skip it so a bolded phrase mid-paragraph
# doesn't get misread as a new part.
MAX_LABEL_LENGTH = 80

MATERIALS_KEYWORDS = [
    "materials", "you will need", "you'll need", "ingredients", "supplies",
    # Hebrew: "materials", "what you'll need", "equipment", "required".
    "חומרים", "מה תצטרכו", "ציוד", "דרוש",
]
ABBREVIATIONS_KEYWORDS = [
    "abbreviation", "abbrev", "glossary", "terms", "ab",
    # Hebrew: "abbreviations", "terms" -- "מילון מונחים" (glossary) already
    # matches via "מונחים" as a substring, same "ab" is a substring of
    # "abbreviation" trick the English list already relies on.
    "קיצורים", "מונחים",
]
INSTRUCTIONS_KEYWORDS = [
    "instructions", "pattern", "crochet pattern", "directions", "how to make",
    # Hebrew: "instructions", "directions/guidelines", "how it's made".
    "הוראות", "הנחיות", "אופן הביצוע",
]

# Matches a numbered line used as a fallback step splitter when a page has
# no line-break markup at all, e.g. "1. Cast on 40 stitches. 2. Join...".
NUMBERED_LINE_RE = re.compile(r"^\d+[.)]\s+")
BOLD_STYLE_RE = re.compile(r"font-weight\s*:\s*(bold|[6-9]00)", re.IGNORECASE)
# A source-page link kept inline as markdown -- "[Yarn name](https://...)"
# -- see _linearize. Only materials keep these (the frontend renders them
# as hyperlinks); every other section is stored as plain text.
MARKDOWN_LINK_RE = re.compile(r"\[([^\[\]]*)\]\((https?://[^)\s]+)\)")


class ScraperError(Exception):
    """Raised when a pattern page can't be fetched or meaningfully parsed."""


def scrape_pattern_from_url(url: str, *, allow_file: bool = False) -> dict:
    """
    Fetch `url` and heuristically extract a pattern draft.

    Never writes to the database -- the caller (the /preview route) is
    responsible for showing this to the user for review before any Pattern
    row is created. Raises ScraperError on network failure or a non-200
    response (including sites that block automated fetching -- see
    looks_like_cloudflare_challenge). See parse_pattern_html for what's returned
    and how parsing failures degrade.

    `allow_file` gates file:// support (see _fetch_html) -- it defaults to
    False because this function is reachable from POST /api/patterns/preview
    with a user-supplied URL, and file:// there would let any logged-in
    user read arbitrary local files off the server. Only the local CLI
    entry point at the bottom of this module passes allow_file=True.
    """
    return parse_pattern_html(_fetch_html(url, allow_file=allow_file), url)
# How long a bot-detection challenge page gets to clear on its own, and how
# long the page itself gets to load. Kept well under gunicorn's request
# timeout (backend/gunicorn.conf.py) -- a fetch that outlives it gets killed
# mid-request and the user sees a bare 500 instead of the friendly
# scraper_error.
PAGE_LOAD_TIMEOUT_MS = 15_000
CHALLENGE_WAIT_MS = 8_000

# A challenge page announces itself in its <title> ("Just a moment...",
# "Attention Required! | Cloudflare"), so the title alone decides whether
# to wait for one to clear -- a real page whose copy happens to say "just a
# moment" mustn't be mistaken for one.
CHALLENGE_TITLE_PHRASES = (
    "just a moment",
    "attention required",
    "checking your browser",
    "security verification",
)
# Only consulted when the response was already an error (see _fetch_html),
# and only near the top of the page, where a block page states it.
BLOCK_BODY_PHRASES = (
    "verify you are human",
    "performing security verification",
    "you have been blocked",
    "checking your browser",
)
BLOCK_BODY_PREFIX_CHARS = 1_000


def looks_like_cloudflare_challenge(page: Page) -> bool:
    title = page.title().lower()
    return any(phrase in title for phrase in CHALLENGE_TITLE_PHRASES)


def _error_page_looks_blocked(page: Page) -> bool:
    """For a non-OK response whose title gave nothing away: does the top of
    the page read like a bot block rather than an ordinary 403/404?"""
    try:
        body = page.locator("body").inner_text(timeout=2_000)
    except Exception:
        return False
    head = body[:BLOCK_BODY_PREFIX_CHARS].lower()
    return any(phrase in head for phrase in BLOCK_BODY_PHRASES)


def _wait_out_challenge(page: Page) -> bool:
    """Give a challenge page up to CHALLENGE_WAIT_MS to clear itself (some
    JS challenges pass on their own and redirect to the real page). True
    once the real page is showing."""
    deadline = time.monotonic() + CHALLENGE_WAIT_MS / 1000
    while time.monotonic() < deadline:
        page.wait_for_timeout(1_000)
        try:
            if not looks_like_cloudflare_challenge(page):
                return True
        except Exception:
            # The challenge redirecting mid-check destroys the page's JS
            # context -- just look again next round.
            continue
    return False


def parse_pattern_html(html: str, source_url: str) -> dict:
    """
    Heuristically extract a pattern draft from already-fetched HTML,
    without doing any network request of its own.

    Used by scrape_pattern_from_url for the normal case, and directly by
    the file-upload fallback (POST /api/patterns/preview-upload) when a
    site's bot-detection blocks Yarnboard's automatic fetch -- in that
    case the user downloads the page themselves and uploads the HTML, but
    `source_url` (for dedup and attribution) is still the URL they typed.

    Returns a dict: title, author, materials, abbreviations, instructions
    ({part_name: [step_text, ...]}), source_site_name, source_domain,
    photo_url. Parsing failures degrade gracefully to empty/None fields
    rather than raising, since a partially-empty draft is still useful to a
    user who's willing to fill in the rest by hand.
    """
    soup = BeautifulSoup(html, "html.parser")

    # Everything that reads the page as-is goes first: _extract_sections
    # rewrites the content container in place (links become "[text](url)"
    # markdown, <br>s become newlines -- see _linearize), which would leak
    # into a linked <h1> or break the "by Jane Doe" byline match.
    site_name, domain = _get_site_name(soup, source_url)
    title = _extract_title(soup)
    author = _extract_author(soup)
    photo_url = _extract_image_url(soup, source_url)
    materials, abbreviations, instructions = _extract_sections(soup, source_url)

    return {
        "title": title,
        "author": author,
        "materials": materials,
        "abbreviations": abbreviations,
        "instructions": instructions,
        "source_site_name": site_name,
        "source_domain": domain,
        "photo_url": photo_url,
    }


def parse_pattern_pdf(pdf_bytes: bytes, source_url: str | None) -> dict:
    """
    Heuristically extract a pattern draft from a PDF file's raw bytes.

    Mirrors parse_pattern_html's contract exactly (same return shape, same
    "never assume this is correct" caveat) -- called from the upload path
    (POST /api/patterns/preview-upload) when the uploaded file is a PDF
    rather than saved HTML, and from the CLI at the bottom of this file.
    `source_url` is whatever URL the user typed alongside the upload, or
    None -- unlike saved HTML, a PDF often has no web page at all (a paid
    download, a file someone emailed), so the link is optional. When
    given, it's used the same way for dedup/attribution as the HTML path.

    The author comes from the file itself -- see _pdf_author.

    PDFs have no tags, so the two HTML-specific signals _extract_sections
    relies on need PDF equivalents: "is this a heading/bold tag" becomes
    "is this line's text rendered in a bold-named font" (pdfplumber
    exposes a fontname per character), and "the page's <h1>" becomes the
    PDF's own title (metadata, falling back to its first line). Once
    reduced to a set of label-line strings and a title string, the actual
    section-classification algorithm (_classify_lines) is identical to
    the HTML path -- see its docstring.
    """
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            metadata = pdf.metadata or {}
            metadata_title = metadata.get("Title")
            xmp_creators = _pdf_xmp_creators(pdf)

            lines: list[str] = []
            label_texts: set[str] = set()
            for page in pdf.pages:
                for line in page.extract_text_lines():
                    text = line["text"].strip()
                    if not text:
                        continue
                    lines.append(text)

                    chars = line.get("chars") or []
                    if not chars or len(text) > MAX_LABEL_LENGTH:
                        continue
                    bold_ratio = sum(
                        1 for c in chars if "bold" in (c.get("fontname") or "").lower()
                    ) / len(chars)
                    if bold_ratio >= PDF_BOLD_LINE_RATIO:
                        label_texts.add(text)
    except Exception as exc:
        raise ScraperError(f"Could not read this PDF: {exc}") from exc

    if metadata_title and metadata_title.strip():
        title = _strip_site_name_suffix(metadata_title.strip())
    elif lines:
        title = lines[0]
    else:
        title = "Untitled Pattern"

    author = _pdf_author(metadata, xmp_creators, lines)

    materials, abbreviations, instructions = _classify_lines(lines, label_texts, {title})

    domain = _bare_domain(source_url) if source_url else None

    return {
        "title": title,
        "author": author,
        "materials": materials,
        "abbreviations": abbreviations,
        "instructions": instructions,
        "source_site_name": domain,
        "source_domain": domain,
        # PDFs have no og:image equivalent -- always None, never omitted,
        # so both parsers return the same shape.
        "photo_url": None,
    }


# Author/Creator values that name nobody: what an OS, an office suite or a
# shared account fills in by default. Compared case-insensitively.
PDF_PLACEHOLDER_AUTHORS = {
    "user", "admin", "administrator", "owner", "unknown", "author", "anonymous",
    "pc", "windows user", "microsoft office user", "microsoft account", "default",
}
# A PDF's "Creator" field is meant to be the program that made the
# original document -- and in practice almost always is ("Microsoft Word",
# "Canva", "Adobe InDesign 18.0"). Only a value that matches none of these
# is treated as a person's name.
#
# Matched on word boundaries so a surname that merely contains a hint
# isn't dropped (Rios/Antonios vs "ios", Scanlon vs "scan", Printz vs
# "print", Wordsworth vs "word", Chromy vs "chrome"):
#   - brand names need only a boundary in front, because real Creator
#     strings glue them to more text ("Microsoft365", "pdfTeX-1.40.25",
#     "PDFium") and no one's name starts with them;
#   - short or everyday words must match as whole words.
_PDF_SOFTWARE_BRANDS = (
    "microsoft", "adobe", "acrobat", "indesign", "illustrator", "photoshop",
    "powerpoint", "libreoffice", "openoffice", "pdf", "latex", "pdftex",
    "ghostscript", "mozilla", "firefox", "chromium", "inkscape", "scribus",
    "canva", "figma", "google", "scansnap", "wkhtmltopdf",
)
_PDF_SOFTWARE_WORDS = (
    "word", "office", "excel", "docs", "pages", "keynote", "writer", "quartz",
    "tex", "skia", "safari", "chrome", "print", "printer", "printed", "scan",
    "scanner", "scanned", "ios", "ipados", "macos", "mac os", "os x", "windows",
    "android", "wps", "affinity", "distiller", "version", "build",
)
PDF_SOFTWARE_HINTS = re.compile(
    r"\b(?:" + "|".join(_PDF_SOFTWARE_BRANDS) + r")"
    + r"|\b(?:" + "|".join(w.replace(" ", r"\s?") for w in _PDF_SOFTWARE_WORDS) + r")\b"
    + r"|\bv?\d+(?:\.\d+)+",  # a version number: "18.2", "v1.40.25"
    re.IGNORECASE,
)


def _pdf_author(metadata: dict, xmp_creators: list[str], lines: list[str]) -> str | None:
    """
    The pattern's writer, taken from the PDF itself, best source first:
      1. the document's Author property,
      2. its XMP metadata's creator (dc:creator -- where Canva, InDesign
         and many export tools put the author's name),
      3. a "by <Name>" / "מאת <name>" byline in the text,
      4. the Creator property -- only when it isn't the name of a program
         (see PDF_SOFTWARE_HINTS), which is what it usually holds.
    Placeholder names ("User", "Microsoft Office User", ...) are skipped
    at every step. None when nothing names a person: the review form
    leaves the field blank rather than guessing.
    """
    for candidate in [metadata.get("Author"), *xmp_creators]:
        name = _clean_pdf_name(candidate)
        if name:
            return name

    byline = _find_author_phrase("\n".join(lines))
    if byline:
        return byline

    creator = _clean_pdf_name(metadata.get("Creator"))
    if creator and not PDF_SOFTWARE_HINTS.search(creator):
        return creator
    return None


def _clean_pdf_name(value) -> str | None:
    """A usable person's name from a PDF metadata value, or None."""
    if isinstance(value, bytes):
        value = value.decode("utf-8", errors="ignore")
    if not isinstance(value, str):
        return None
    name = re.sub(r"\s+", " ", value).strip(" \t;,")
    if not name or len(name) > 100 or "@" in name:
        return None
    if name.lower() in PDF_PLACEHOLDER_AUTHORS:
        return None
    return name


# XMP packets are a few KB (Adobe pads them to ~2-4 KB; one with an
# embedded thumbnail can reach tens of KB). Anything bigger isn't worth
# reading for an author name -- and capping it, before decompressing or
# parsing, keeps a crafted upload from tying up the request worker.
XMP_MAX_BYTES = 256 * 1024


def _pdf_xmp_creators(pdf) -> list[str]:
    """The dc:creator entries of a PDF's XMP metadata, in order. Empty if
    it has none, or if it can't be read safely -- a malformed or hostile
    metadata stream must never fail (or stall) the whole upload.

    The PDF is user-uploaded, so the stream is treated as hostile:
      - its size is capped before anything is decoded, and it's
        decompressed here with a hard output limit (pdfminer's get_data()
        would inflate a compression bomb in full first);
      - the XML is parsed with defusedxml with DTDs forbidden, so no
        entity definition (billion laughs, external entities) is ever
        expanded.
    """
    try:
        from defusedxml import ElementTree
        from pdfminer.pdftypes import PDFStream, resolve1

        stream = resolve1(pdf.doc.catalog.get("Metadata"))
        if not isinstance(stream, PDFStream):
            return []
        data = _bounded_stream_bytes(stream, XMP_MAX_BYTES)
        if data is None:
            return []
        root = ElementTree.fromstring(data, forbid_dtd=True)
        ns = {
            "dc": "http://purl.org/dc/elements/1.1/",
            "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
        }
        return [
            li.text.strip()
            for creator in root.iter(f"{{{ns['dc']}}}creator")
            for li in creator.iter(f"{{{ns['rdf']}}}li")
            if li.text and li.text.strip()
        ]
    except Exception:
        return []


def _bounded_stream_bytes(stream, max_bytes: int) -> bytes | None:
    """A PDF stream's decoded bytes, or None if it would exceed `max_bytes`
    (compressed or decompressed) or uses an encoding other than none or
    plain Flate (zlib) -- the only two an XMP packet uses in practice."""
    raw = stream.get_rawdata()
    if raw is None or len(raw) > max_bytes:
        return None
    filters = stream.get_filters()
    if not filters:
        return raw
    if len(filters) != 1:
        return None
    name, params = filters[0]
    if getattr(name, "name", name) not in ("FlateDecode", "Fl") or params:
        return None  # params would mean a PNG/TIFF predictor: not XMP
    inflater = zlib.decompressobj()
    data = inflater.decompress(raw, max_bytes + 1)
    if len(data) > max_bytes or inflater.unconsumed_tail:
        return None
    return data


MANUAL_SOURCE_PREFIX = "manual:"
TEXT_HEADING_RE = re.compile(r"^#{1,6}\s+(.+)$")


def parse_pattern_text(text: str, source_url: str | None = None) -> dict:
    """
    Pattern draft from plain text -- pasted by the user, or transcribed from
    photos (see transcription.py). Same return shape as parse_pattern_html.

    There's no styling to find part labels by, so a line counts as a label
    when it's short and either a "# Heading" (what photo transcription
    emits) or ends with ":" ("Body:"). Not all-caps lines: "DROPS AIR" in a
    materials list would end the list early.
    The first line is the title. If nothing at all looks like a section,
    every remaining line becomes one "Instructions" part, so a plain list of
    steps still turns into a checklist. `source_url` is optional -- a
    pattern typed from a book has none (see submit_pattern's manual: URLs).
    """
    lines: list[str] = []
    label_texts: set[str] = set()
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        heading = TEXT_HEADING_RE.match(line)
        if heading:
            line = heading.group(1).strip()
        is_label = len(line) <= MAX_LABEL_LENGTH and (bool(heading) or line.endswith(":"))
        lines.append(line)
        if is_label:
            label_texts.add(line)

    title = lines[0] if lines else "Untitled Pattern"
    author = _find_author_phrase("\n".join(lines))
    materials, abbreviations, instructions = _classify_lines(lines, label_texts, {title})
    if not materials and not abbreviations and not instructions and len(lines) > 1:
        instructions = {"Instructions": _split_into_steps(lines[1:])}

    domain = _bare_domain(source_url) if source_url else None
    return {
        "title": title,
        "author": author,
        "materials": materials,
        "abbreviations": abbreviations,
        "instructions": instructions,
        "source_site_name": domain,
        "source_domain": domain,
        "photo_url": None,
    }


def _is_public_hostname(hostname: str) -> bool:
    """
    True if every address `hostname` resolves to is a normal public
    internet address -- false for loopback (127.0.0.1, ::1), private
    (10.x, 192.168.x, ...), link-local (169.254.x.x, including cloud
    metadata endpoints like 169.254.169.254), and other reserved ranges.
    A hostname that fails to resolve at all is treated as not public.
    """
    try:
        infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        return False
    for info in infos:
        addr = ipaddress.ip_address(info[4][0])
        if (
            addr.is_private
            or addr.is_loopback
            or addr.is_link_local
            or addr.is_reserved
            or addr.is_multicast
            or addr.is_unspecified
        ):
            return False
    return True


def _is_request_allowed(url: str) -> bool:
    """
    Used by the page.route handler in _fetch_html to vet every request the
    browser makes while rendering a page (main navigation, redirects, and
    sub-resources alike), since a same-site redirect or DNS rebind could
    otherwise steer the browser at an internal address after the initial
    URL has already passed _guard_request_url. Non-network schemes
    (data:, blob:, about:, ...) are harmless and always allowed; file: is
    always blocked here regardless of the allow_file flag (that flag only
    covers *this module* reading a local path directly, never the browser
    navigating to one); http(s) requests must resolve to a public address.
    """
    parsed = urlparse(url)
    if parsed.scheme == "file":
        return False
    if parsed.scheme not in ("http", "https"):
        return True
    return bool(parsed.hostname) and _is_public_hostname(parsed.hostname)


def _guard_request_url(url: str) -> None:
    """
    Raise ScraperError unless `url` is a plain http(s) URL pointing at a
    public address. Used as the up-front check on the URL the caller
    actually asked to fetch, before Playwright is even launched.
    """
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ScraperError(f"Unsupported URL scheme for fetching: {parsed.scheme or url!r}")
    if not parsed.hostname or not _is_public_hostname(parsed.hostname):
        raise ScraperError(f"{url} points at a private or unreachable address and can't be fetched.")


def _fetch_html(url: str, *, allow_file: bool = False) -> str:
    """
    Download the page HTML, raising ScraperError on any failure.

    Uses a headless browser (Playwright) to handle JavaScript-based sites
    and bot-detection challenges (e.g. Cloudflare).

    When allow_file=True, also accepts file:// URLs, which are read
    straight off disk instead of over HTTP -- handy for testing the
    extraction heuristics against a saved HTML snapshot (see the CLI entry
    point at the bottom of this file, which turns a plain local path into
    one of these automatically). Defaults to False because this is
    reachable from a user-supplied URL via POST /api/patterns/preview,
    where file:// access would be an arbitrary local file read.
    """
    if url.startswith("file://"):
        if not allow_file:
            raise ScraperError("file:// URLs are not supported here.")
        # unquote is required here: Path.resolve().as_uri() (used by the
        # CLI below) percent-encodes characters like spaces (" " -> "%20")
        # per the URI spec, but urlparse() does not decode that back --
        # without this, a path containing a space would 404 against a
        # literal "%20" instead of opening the real file.
        path = unquote(urlparse(url).path)
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                return f.read()
        except OSError as exc:
            raise ScraperError(f"Could not read {path}: {exc}") from exc

    _guard_request_url(url)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(user_agent=USER_AGENT)
        # Re-checked per-request (not just the initial URL above) so a
        # redirect chain can't steer the browser at an internal address
        # after the up-front check on the original URL already passed.
        page.route("**/*", lambda route: (
            route.continue_() if _is_request_allowed(route.request.url) else route.abort()
        ))
        try:
            response = page.goto(url, timeout=PAGE_LOAD_TIMEOUT_MS, wait_until="domcontentloaded")

            blocked = ScraperError(
                f"{url} is protected by a bot-detection service (e.g. Cloudflare) that "
                "blocks automated fetching. You can try saving the page's HTML "
                "yourself and using the file upload option instead."
            )
            if looks_like_cloudflare_challenge(page):
                if not _wait_out_challenge(page):
                    raise blocked
            elif response is None or not response.ok:
                # A hard block (no challenge to wait out) fails at once.
                if _error_page_looks_blocked(page):
                    raise blocked
                status = response.status if response else "unknown"
                raise ScraperError(f"{url} returned HTTP {status}")

            content = page.content()
        except ScraperError:
            raise
        except PlaywrightTimeoutError as exc:
            raise ScraperError(f"Timed out trying to fetch {url}") from exc
        except Exception as exc:
            raise ScraperError(f"Could not fetch {url} with Playwright: {exc}") from exc
        finally:
            browser.close()

    return content


def _get_site_name(soup: BeautifulSoup, url: str) -> tuple[str, str]:
    """
    Return (source_site_name, source_domain) for attribution.

    site_name prefers the page's own `og:site_name` meta tag (most sites
    that care about link previews set this); domain is always derivable
    from the URL itself and used both as a fallback display name and as a
    stable identifier independent of a site's metadata choices.
    """
    domain = _bare_domain(url)
    meta = soup.find("meta", property="og:site_name")
    site_name = meta["content"].strip() if meta and meta.get("content") else domain
    return site_name, domain


def _extract_image_url(soup: BeautifulSoup, source_url: str) -> str | None:
    """
    Best-effort "photo of the pattern/finished object" for the draft,
    reusing whatever preview image the page already set up for link
    unfurling. Priority: `og:image` -> `twitter:image` (a `name=`
    attribute, unlike the `property=` og: tags). Relative/scheme-relative
    URLs (common in these tags) are resolved against `source_url` via
    urljoin so the frontend can drop the result straight into an <img src>.
    Returns None rather than guessing when neither tag is present -- this
    is just a draft field the user can review/clear before publishing.
    """
    for prop in ("og:image", "og:image:url"):
        meta = soup.find("meta", property=prop)
        if meta and meta.get("content"):
            return urljoin(source_url, meta["content"].strip())

    meta = soup.find("meta", attrs={"name": "twitter:image"})
    if meta and meta.get("content"):
        return urljoin(source_url, meta["content"].strip())

    return None


def _bare_domain(url: str) -> str:
    netloc = urlparse(url).netloc
    return netloc[4:] if netloc.startswith("www.") else netloc


def _extract_title(soup: BeautifulSoup) -> str:
    """Priority: og:title meta -> first <h1> -> <title> tag (trimmed)."""
    og_title = soup.find("meta", property="og:title")
    if og_title and og_title.get("content"):
        return og_title["content"].strip()

    h1 = soup.find("h1")
    # " " separator: get_text(strip=True) alone would glue "Cozy <a>Beanie</a>"
    # into "CozyBeanie".
    h1_text = h1.get_text(" ", strip=True) if h1 else ""
    if h1_text:
        return h1_text

    if soup.title and soup.title.string:
        return _strip_site_name_suffix(soup.title.string.strip())

    return "Untitled Pattern"


def _strip_site_name_suffix(title: str) -> str:
    """
    Strips a trailing " | Site Name" / " - Site Name" suffix from a title.
    Shared by the HTML <title> tag fallback and the PDF metadata Title
    field -- PDFs "printed" from a webpage (a common way patterns end up
    as PDFs at all) frequently inherit that page's <title> verbatim,
    suffix and all, into their own embedded Title property.
    """
    return re.split(r"\s*[|–-]\s*", title)[0]


def _extract_author(soup: BeautifulSoup) -> str | None:
    """
    Priority: <meta name="author"> -> a "by <name>" / "designed by <name>"
    phrase near the top of the page. Returns None (left blank in the
    review form) rather than guessing when nothing is found.
    """
    meta = soup.find("meta", attrs={"name": "author"})
    if meta and meta.get("content"):
        return meta["content"].strip()

    # One line per block element (on a copy -- _linearize edits in place),
    # so a byline can't run on into the next heading: a flat
    # get_text(" ") turned "by Jane Doe" + "<h2>Materials" into
    # "Jane Doe Materials".
    lines = _linearize(copy.copy(soup.body or soup))
    return _find_author_phrase("\n".join(lines))


def _find_author_phrase(text: str) -> str | None:
    """
    Shared by both the HTML and PDF extraction paths: searches the first
    ~2000 characters of plain text for a "by <Name>" / "designed by
    <Name>" phrase. Used as the fallback when there's no more authoritative
    metadata field available (an HTML <meta name="author"> tag, or a PDF's
    embedded Author property).
    """
    match = re.search(
        # Name words are joined by spaces/tabs only, never a newline -- the
        # next line is the next block (a heading, a paragraph), not more name.
        r"\b(?:designed by|pattern by|written by|by)\s+([A-Z][\w'.-]+(?:[ \t]+[A-Z][\w'.-]+){0,2})",
        text[:2000],
    )
    if match:
        return match.group(1).strip()

    # Hebrew has no letter casing, so the [A-Z] signal above -- which
    # doubles as an implicit "this still looks like part of the name, not
    # the next sentence" boundary -- doesn't apply. Without it, capping at
    # 3 words (like the Latin pattern) is too greedy: get_text(" ") joins
    # separate tags with a single space, so a name immediately followed by
    # the next heading (e.g. "מאת דנה כהן חומרים") would swallow that
    # heading's first word as if it were part of the name. Capped at 2
    # words instead (first + last name, the common case) to keep that
    # failure mode rare rather than eliminating a signal we don't have.
    hebrew_match = re.search(
        r"(?:מאת|עיצוב(?: של| על ידי)?|נוצר על ידי)\s*[:\-]?\s*"
        r"([א-ת]+['׳]?(?:[ \t]+[א-ת]+['׳]?){0,1})",
        text[:2000],
    )
    return hebrew_match.group(1).strip() if hebrew_match else None


def _is_bold(tag) -> bool:
    """True if `tag` is visually bold -- either semantically (<strong>/<b>)
    or via an inline `font-weight` style, which is how many older/simpler
    pattern blogs (classic Blogger templates especially) mark section names
    instead of using real heading markup."""
    if tag.name in ("strong", "b"):
        return True
    return bool(BOLD_STYLE_RE.search(tag.get("style") or ""))


def _is_label_tag(tag) -> bool:
    """A tag counts as a possible section/part label if it's a heading tag,
    or if it's bold and short -- see MAX_LABEL_LENGTH for why "short"
    matters (a long bolded sentence is prose, not a label)."""
    if tag.name in ALWAYS_LABEL_TAGS:
        return True
    if tag.name in MAYBE_BOLD_LABEL_TAGS and _is_bold(tag):
        text = tag.get_text(strip=True)
        return bool(text) and len(text) <= MAX_LABEL_LENGTH
    return False


def _find_content_container(soup: BeautifulSoup):
    """
    Best-effort scoping to the actual pattern content, so sidebar/footer
    noise (nav links, "About Me" widgets, follower lists, etc. -- all
    common on blog templates) doesn't get scanned alongside the real post
    and misread as pattern sections. Falls back to <body> if nothing more
    specific matches -- never the whole document, since <head> contains
    the <title> tag, which by SEO convention often reads like
    "X Pattern | Site Name" and would otherwise self-match the
    instructions keyword the same way the page's <h1> can (see the
    title-exclusion note on _extract_sections).
    """
    # Some themes wrap every blog *comment* in its own <article> too (seen
    # on WordPress/Divi sites, e.g. <article class="comment-body">) --
    # taking the first <article> on the page unconditionally can land on
    # a random early comment instead of the real post. Skip those.
    for article in soup.find_all("article"):
        classes = " ".join(article.get("class") or [])
        if "comment" in classes or "comment" in (article.get("id") or ""):
            continue
        return article

    tag = soup.find(attrs={"itemprop": "articleBody"})
    if tag:
        return tag

    # Separator varies by theme/builder -- "entry-content" (hyphen) is the
    # common WordPress convention, but page-builder themes like Divi use
    # underscores instead (e.g. "et_pb_post_content"), so both must match.
    class_re = re.compile(r"(post[-_]body|entry[-_]content|post[-_]content|article[-_]body|article[-_]content)", re.I)
    tag = soup.find(attrs={"class": class_re})
    if tag:
        return tag

    return soup.body or soup


def _strip_links(line: str) -> str:
    """A line with any markdown link reduced to just its link text."""
    return MARKDOWN_LINK_RE.sub(r"\1", line)


def _linearize(container, base_url: str | None = None) -> list[str]:
    """
    Flatten `container` into a list of non-empty text lines, one per
    visual line break. <br> tags become newlines directly; other
    block-level tags (see BLOCK_LEVEL_TAGS) get a trailing newline
    appended after their own content so each one still ends its own line,
    without breaking apart *inline* tags (<span>, <strong>, <a>, ...) that
    should stay concatenated on the same line as their surrounding text.
    This works whether a page uses proper <p>/<h2>/<ul><li> structure or
    (very common on older pattern blogs) just flows text and <br> tags
    with the occasional bold <span> as a pseudo-heading.

    With `base_url`, every http(s) <a> becomes inline markdown
    "[text](absolute-url)" so a materials line like "Yarn: Drops Air" keeps
    the shop link the source page had on it. _classify_lines matches
    keywords/labels against the link-stripped text and only lets
    materials keep the markdown.
    """
    if base_url:
        for a in container.find_all("a", href=True):
            href = urljoin(base_url, a["href"].strip())
            text = a.get_text(" ", strip=True).replace("[", "(").replace("]", ")")
            if text and urlparse(href).scheme in ("http", "https") and not re.search(r"[\s)]", href):
                a.replace_with(f"[{text}]({href})")
    for br in container.find_all("br"):
        br.replace_with("\n")
    for tag in container.find_all(BLOCK_LEVEL_TAGS):
        tag.append("\n")

    raw = container.get_text()
    return [line.strip() for line in raw.split("\n") if line.strip()]


def _extract_sections(soup: BeautifulSoup, source_url: str | None = None) -> tuple[str, str, dict]:
    """
    HTML front-end for _classify_lines: finds the real content container,
    collects "label" tag texts (headings + bold-styled short tags) and the
    page's own <h1> title text (excluded from matching -- see
    _classify_lines' docstring for why), and linearizes the container into
    plain text lines. The actual section-classification algorithm is
    format-agnostic and lives in _classify_lines, shared with the PDF
    extraction path (parse_pattern_pdf) -- neither "bold tag" nor "<h1>"
    are HTML-specific concepts once reduced to a set of label/title
    strings, so nothing about the classification itself needs to change
    for a different input format.
    """
    container = _find_content_container(soup)

    label_texts = {tag.get_text(strip=True) for tag in container.find_all(_is_label_tag)}
    title_lines = {tag.get_text(strip=True) for tag in container.find_all("h1")}

    lines = _linearize(container, source_url)

    return _classify_lines(lines, label_texts, title_lines)


def _classify_lines(
    lines: list[str], label_texts: set[str], excluded_lines: set[str]
) -> tuple[str, str, dict]:
    """
    Single pass that splits a list of already-linearized text lines into
    materials, abbreviations, and named instruction parts. Format-agnostic:
    doesn't know or care whether `lines` came from HTML or a PDF, only that
    `label_texts` identifies which of those lines are section/part labels
    (however "bold" was determined for that format) and `excluded_lines`
    identifies the page/document title (excluded from matching -- see
    below).

    Heuristic, checked in priority order for every line:
      1. Keyword match first, regardless of styling: if a short line's text
         contains a materials/abbreviations/instructions keyword, it starts
         that section -- even if the line isn't in `label_texts` at all.
         Most pattern pages are consistent about the *words* "Materials",
         "Abbreviations", "Instructions"/"Directions"/"Pattern" (or their
         Hebrew equivalents -- see MATERIALS_KEYWORDS et al., which carry
         both) even when they're inconsistent (or entirely absent) about
         bolding them, so keyword text is the stronger, more portable
         signal and is checked before anything else.
      2. `label_texts` membership as a fallback, used only to find *part*
         boundaries within the instructions once we're past whichever of
         the above got us there -- arbitrary part names like "Body:" or
         "Cuff's Ribbing:" (in any language/script) have no shared keyword
         vocabulary, so styling (however it's represented for this format)
         is the only signal available for those -- this step is already
         language-agnostic, since it never inspects the label text itself.
    Lines before the first recognized section are discarded. A part is only
    kept if at least one step line was collected for it, so a heading that
    turns out to be immediately followed by another heading (e.g. a bare
    "Instructions:" line used only to introduce the first real part)
    doesn't leave behind an empty part.

    `excluded_lines` (the document's own title) is skipped entirely --
    pattern titles routinely contain the word "pattern" (e.g. "Cozy Beanie
    Pattern"), which would otherwise self-match the instructions keyword
    and anchor extraction on the title instead of the real content. This
    applies equally to an HTML page's <h1> and a PDF's title (from its
    metadata or first line) -- same risk, same fix.
    """
    materials_lines: list[str] = []
    abbreviations_lines: list[str] = []
    parts: dict[str, list[str]] = {}

    state: str | tuple[str, str] | None = None
    current_lines: list[str] = []

    def flush():
        if not current_lines:
            return
        if state == "materials":
            materials_lines.extend(current_lines)
        elif state == "abbreviations":
            abbreviations_lines.extend(current_lines)
        elif isinstance(state, tuple) and state[0] == "part":
            parts.setdefault(state[1], [])
            parts[state[1]].extend(_split_into_steps(current_lines))

    for raw_line in lines:
        # Matching (and every section but materials) uses the link-free
        # text -- a URL could otherwise contain a keyword like "pattern".
        line = _strip_links(raw_line)
        if line in excluded_lines:
            continue

        lowered = line.lower()
        short_enough = len(line) <= MAX_LABEL_LENGTH

        if short_enough and any(k in lowered for k in MATERIALS_KEYWORDS):
            flush()
            current_lines = []
            state = "materials"
            continue

        if short_enough and any(k in lowered for k in ABBREVIATIONS_KEYWORDS):
            flush()
            current_lines = []
            state = "abbreviations"
            continue

        if short_enough and any(k in lowered for k in INSTRUCTIONS_KEYWORDS):
            flush()
            current_lines = []
            state = ("part", line.rstrip(":").strip() or f"Part {len(parts) + 1}")
            continue

        if line in label_texts:
            flush()
            current_lines = []
            state = ("part", line.rstrip(":").strip() or f"Part {len(parts) + 1}")
            continue

        if state == "materials":
            current_lines.append(raw_line)
        elif state is not None:
            current_lines.append(line)

    flush()
    return "\n".join(materials_lines), "\n".join(abbreviations_lines), parts


def _split_into_steps(lines: list[str]) -> list[str]:
    """
    Given raw collected lines for a part, return a clean list of step
    strings. If the lines already look like discrete <li> entries (no
    embedded numbering), they're used as-is. Otherwise, lines are treated
    as prose and re-split on numbered-line boundaries ("1. ", "2) ", ...).
    """
    steps: list[str] = []
    for line in lines:
        # A single line may itself contain multiple "1. ... 2. ..." steps
        # when it came from one big <p> rather than a <ul>.
        pieces = NUMBERED_LINE_RE.split(line)
        pieces = [p.strip() for p in pieces if p.strip()]
        steps.extend(pieces if pieces else [line])
    return steps


if __name__ == "__main__":
    # Quick manual testing against a real URL or a local HTML/PDF file,
    # without going through Flask or the database at all -- handy while
    # iterating on the heuristics. Usage (from backend/, with the venv
    # active):
    #   python3 -m app.scraper <url>
    #   python3 -m app.scraper ./some-saved-pattern-page.html
    #   python3 -m app.scraper ./some-pattern.pdf
    #
    # Must be run as `-m app.scraper`, NOT `python3 app/scraper.py`
    # directly -- direct script execution puts backend/app/ itself (not
    # backend/) on sys.path, and this package's own app/email.py then
    # shadows Python's *stdlib* email package for the whole process.
    # pdfplumber's dependency chain imports the real stdlib `email`
    # internally, so that collision breaks PDF parsing specifically with
    # a confusing ModuleNotFoundError deep inside pdfminer. `-m` avoids it
    # by putting backend/ (the actual package root) on sys.path instead.
    import json
    import sys
    from pathlib import Path

    if len(sys.argv) != 2:
        print("Usage: python3 -m app.scraper <url-or-local-html-or-pdf-file>", file=sys.stderr)
        sys.exit(1)

    target = sys.argv[1]

    # A local PDF path goes through parse_pattern_pdf directly (it needs
    # raw bytes, not something _fetch_html/parse_pattern_html can produce)
    # -- the URL used for attribution is just the local path turned into a
    # file:// URI, same placeholder convention the HTML file case already
    # uses for source_url when there's no real URL to speak of.
    if not target.startswith(("http://", "https://", "file://")) and target.lower().endswith(".pdf"):
        local_path = Path(target)
        if not local_path.is_file():
            print(f"Not an existing file: {target}", file=sys.stderr)
            sys.exit(1)
        try:
            result = parse_pattern_pdf(local_path.read_bytes(), local_path.resolve().as_uri())
        except ScraperError as exc:
            print(f"ScraperError: {exc}", file=sys.stderr)
            sys.exit(1)
        print(json.dumps(result, indent=2))
        sys.exit(0)

    if not target.startswith(("http://", "https://", "file://")):
        # Not already a URL -- treat it as a local path and turn it into a
        # file:// URL so _fetch_html can handle both cases uniformly.
        local_path = Path(target)
        if not local_path.is_file():
            print(f"Not a URL and not an existing file: {target}", file=sys.stderr)
            sys.exit(1)
        target = local_path.resolve().as_uri()
    try:
        result = scrape_pattern_from_url(target, allow_file=True)
    except ScraperError as exc:
        print(f"ScraperError: {exc}", file=sys.stderr)
        sys.exit(1)

    print(json.dumps(result, indent=2))
