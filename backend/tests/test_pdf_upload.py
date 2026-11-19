"""Uploading a PDF on the Submit page (POST /api/patterns/preview-upload):
the original link is optional for a PDF (still required for a saved web
page), and the author is read from the file itself -- see
scraper._pdf_author for the order of sources.

PDFs are built in-test (make_pdf) so each case controls exactly which
metadata and text the file carries."""
import io
import time
import zlib

import pytest

from app.extensions import db
from app.models import User
from app.scraper import XMP_MAX_BYTES, _pdf_author, parse_pattern_pdf

PATTERN_LINES = [
    "Cozy Beanie",
    "Materials:",
    "1 skein worsted yarn",
    "Instructions:",
    "Cast on 88 stitches.",
]


def _pdf_string(text: str) -> str:
    return "(" + text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)") + ")"


def _xmp_packet(creators) -> bytes:
    items = "".join(f"<rdf:li>{name}</rdf:li>" for name in creators)
    return (
        '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF '
        'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
        '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">'
        f"<dc:creator><rdf:Seq>{items}</rdf:Seq></dc:creator>"
        "</rdf:Description></rdf:RDF></x:xmpmeta>"
    ).encode("utf-8")


def make_pdf(lines=PATTERN_LINES, info=None, xmp_creators=None, xmp_raw=None, xmp_compress=False) -> bytes:
    """A small, valid one-page PDF: `lines` as text, `info` as the document
    information dictionary (Author, Creator, Title...), and an XMP metadata
    stream -- either built from `xmp_creators` (dc:creator entries) or
    given verbatim as `xmp_raw` bytes; `xmp_compress` Flate-compresses it,
    as most real PDFs do."""
    content = "BT /F1 12 Tf 72 720 Td 16 TL " + " ".join(f"{_pdf_string(l)} Tj T*" for l in lines) + " ET"
    xmp = xmp_raw if xmp_raw is not None else (_xmp_packet(xmp_creators) if xmp_creators else None)
    objects = {
        1: ("<< /Type /Catalog /Pages 2 0 R" + (" /Metadata 6 0 R" if xmp is not None else "") + " >>").encode(),
        2: b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        3: b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
           b"/Resources << /Font << /F1 5 0 R >> >> >>",
        4: f"<< /Length {len(content)} >>\nstream\n{content}\nendstream".encode(),
        5: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    }
    if xmp is not None:
        body = zlib.compress(xmp) if xmp_compress else xmp
        flate = " /Filter /FlateDecode" if xmp_compress else ""
        objects[6] = (
            f"<< /Type /Metadata /Subtype /XML{flate} /Length {len(body)} >>\nstream\n".encode()
            + body + b"\nendstream"
        )
    if info:
        objects[7] = ("<< " + " ".join(f"/{k} {_pdf_string(v)}" for k, v in info.items()) + " >>").encode()

    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = {}
    for number in sorted(objects):
        offsets[number] = out.tell()
        out.write(f"{number} 0 obj\n".encode() + objects[number] + b"\nendobj\n")
    xref_at = out.tell()
    size = max(objects) + 1
    out.write(f"xref\n0 {size}\n0000000000 65535 f \n".encode())
    for number in range(1, size):
        if number in offsets:
            out.write(f"{offsets[number]:010d} 00000 n \n".encode())
        else:
            out.write(b"0000000000 65535 f \n")
    trailer = f"<< /Size {size} /Root 1 0 R" + (" /Info 7 0 R" if info else "") + " >>"
    out.write(f"trailer\n{trailer}\nstartxref\n{xref_at}\n%%EOF\n".encode())
    return out.getvalue()


def _register_and_login(client, username="maker"):
    email = f"{username}@test.com"
    client.post("/api/register", json={"username": username, "email": email, "password": "password123"})
    with client.application.app_context():
        user = User.query.filter_by(email=email).first()
        user.email_verified = True
        db.session.commit()
    client.post("/api/login", json={"email": email, "password": "password123"})


def _upload(client, file_bytes, filename="pattern.pdf", url=None):
    data = {"html_file": (io.BytesIO(file_bytes), filename)}
    if url is not None:
        data["url"] = url
    return client.post("/api/patterns/preview-upload", data=data, content_type="multipart/form-data")


# --- The link: optional for a PDF, required for a saved web page -----------


def test_pdf_upload_without_a_link_returns_a_draft(client):
    _register_and_login(client)
    response = _upload(client, make_pdf(info={"Author": "Jane Designer"}))
    assert response.status_code == 200, response.get_json()
    body = response.get_json()
    assert body["duplicate"] is False
    assert body["already_shared_with_you"] is None
    draft = body["draft"]
    assert draft["title"] == "Cozy Beanie"
    assert draft["author"] == "Jane Designer"
    assert draft["source_domain"] is None
    assert draft["source_site_name"] is None
    assert "Cast on 88 stitches." in sum(draft["instructions"].values(), [])


def test_pdf_upload_without_a_link_is_saved_with_no_source_link(client):
    _register_and_login(client)
    draft = _upload(client, make_pdf()).get_json()["draft"]
    saved = client.post("/api/patterns/submit", json={**draft, "original_url": ""})
    assert saved.status_code == 201
    pattern = saved.get_json()["pattern"]
    assert pattern["has_source_link"] is False
    assert pattern["original_url"].startswith("manual:")


def test_pdf_upload_with_a_link_still_credits_it_and_catches_duplicates(client):
    _register_and_login(client)
    url = "https://example.com/cozy-beanie"
    draft = _upload(client, make_pdf(), url=url).get_json()["draft"]
    assert draft["source_domain"] == "example.com"

    client.post("/api/patterns/submit", json={**draft, "original_url": url})
    again = _upload(client, make_pdf(), url=url).get_json()
    assert again["duplicate"] is True


def test_saved_web_page_still_needs_its_link(client):
    _register_and_login(client)
    html = b"<html><body><h1>Cozy Beanie</h1><h2>Materials</h2><ul><li>yarn</li></ul></body></html>"
    response = _upload(client, html, filename="page.html")
    assert response.status_code == 400
    assert response.get_json()["code"] == "url_required"


def test_a_link_that_isnt_http_is_refused(client):
    _register_and_login(client)
    response = _upload(client, make_pdf(), url="ftp://example.com/x.pdf")
    assert response.status_code == 400
    assert response.get_json()["code"] == "invalid_source_url"


def test_the_pdf_check_uses_the_file_bytes_not_its_name(client):
    """A web page renamed to .pdf is still a web page: link required."""
    _register_and_login(client)
    response = _upload(client, b"<html><body><h1>Not a PDF</h1></body></html>", filename="sneaky.pdf")
    assert response.status_code == 400
    assert response.get_json()["code"] == "url_required"


# --- The author, from the file itself ---------------------------------------


@pytest.mark.parametrize(
    ("info", "xmp", "lines", "expected"),
    [
        pytest.param({"Author": "Jane Designer"}, None, PATTERN_LINES, "Jane Designer", id="author-property"),
        pytest.param({"Author": "Microsoft Office User"}, ["Dana Cohen"], PATTERN_LINES, "Dana Cohen",
                     id="placeholder-author-falls-to-xmp-creator"),
        pytest.param({}, ["Dana Cohen", "Second Person"], PATTERN_LINES, "Dana Cohen", id="xmp-creator-first-entry"),
        pytest.param({"Creator": "Canva"}, None, ["Cozy Beanie", "Designed by Rivka Levi", *PATTERN_LINES[1:]],
                     "Rivka Levi", id="byline-in-the-text"),
        pytest.param({"Creator": "Rivka Levi"}, None, PATTERN_LINES, "Rivka Levi", id="creator-that-is-a-person"),
        pytest.param({"Creator": "Microsoft® Word for Microsoft 365"}, None, PATTERN_LINES, None,
                     id="creator-that-is-software"),
        pytest.param({"Creator": "Adobe InDesign 18.2 (Macintosh)"}, None, PATTERN_LINES, None,
                     id="creator-that-is-design-software"),
        pytest.param({"Author": "user", "Creator": "admin"}, None, PATTERN_LINES, None, id="placeholders-only"),
        pytest.param({}, None, PATTERN_LINES, None, id="nothing-names-anyone"),
    ],
)
def test_pdf_author_comes_from_the_file(info, xmp, lines, expected):
    draft = parse_pattern_pdf(make_pdf(lines=lines, info=info or None, xmp_creators=xmp), None)
    assert draft["author"] == expected


def test_author_property_beats_a_byline_in_the_text():
    assert _pdf_author({"Author": "From Metadata"}, [], ["by Someone Else"]) == "From Metadata"


def test_an_email_address_is_not_used_as_the_author():
    assert _pdf_author({"Author": "jane@example.com"}, [], []) is None


def test_a_broken_xmp_stream_never_fails_the_upload():
    pdf = make_pdf(xmp_creators=["Dana Cohen"]).replace(b"</x:xmpmeta>", b"<oops")
    draft = parse_pattern_pdf(pdf, None)
    assert draft["title"] == "Cozy Beanie"


# --- Hostile XMP metadata: never expanded, never decompressed unbounded ------
#
# The PDF is user-uploaded, so its metadata stream is untrusted input to an
# XML parser. Each of these must come back quickly with no XMP author (the
# lookup just moves on) rather than raise, hang or balloon memory.

BILLION_LAUGHS = (
    b'<?xml version="1.0"?><!DOCTYPE x ['
    b'<!ENTITY a "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa">'
    + b"".join(
        f'<!ENTITY {chr(98 + i)} "{("&" + chr(97 + i) + ";") * 10}">'.encode() for i in range(9)
    )
    + b']><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF '
    b'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    b'<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/">'
    b"<dc:creator><rdf:Seq><rdf:li>&j;</rdf:li></rdf:Seq></dc:creator>"
    b"</rdf:Description></rdf:RDF></x:xmpmeta>"
)

EXTERNAL_ENTITY = (
    b'<?xml version="1.0"?><!DOCTYPE x [<!ENTITY secret SYSTEM "file:///etc/passwd">]>'
    b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF '
    b'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    b'<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/">'
    b"<dc:creator><rdf:Seq><rdf:li>&secret;</rdf:li></rdf:Seq></dc:creator>"
    b"</rdf:Description></rdf:RDF></x:xmpmeta>"
)


def _parse_quickly(pdf: bytes):
    started = time.monotonic()
    draft = parse_pattern_pdf(pdf, None)
    assert time.monotonic() - started < 3, "hostile metadata stalled the parser"
    return draft


@pytest.mark.parametrize("compress", [False, True], ids=["plain", "flate"])
def test_billion_laughs_in_xmp_is_not_expanded(compress):
    draft = _parse_quickly(make_pdf(xmp_raw=BILLION_LAUGHS, xmp_compress=compress))
    assert draft["title"] == "Cozy Beanie"
    assert draft["author"] is None


def test_external_entity_in_xmp_is_not_resolved():
    draft = _parse_quickly(make_pdf(xmp_raw=EXTERNAL_ENTITY))
    assert draft["author"] is None


def test_a_compression_bomb_in_xmp_is_not_inflated():
    # ~50 MB of whitespace inside a valid packet compresses to ~50 KB --
    # under the raw-size cap, so only the bounded decompression stops it.
    bomb = _xmp_packet(["Should Not Be Read"]).replace(b"<x:xmpmeta", b" " * 50_000_000 + b"<x:xmpmeta", 1)
    pdf = make_pdf(xmp_raw=bomb, xmp_compress=True)
    assert len(pdf) < XMP_MAX_BYTES
    draft = _parse_quickly(pdf)
    assert draft["author"] is None


def test_an_oversized_xmp_stream_is_skipped():
    big = _xmp_packet(["Should Not Be Read"]).replace(b"<x:xmpmeta", b" " * (XMP_MAX_BYTES + 1) + b"<x:xmpmeta", 1)
    draft = _parse_quickly(make_pdf(xmp_raw=big))
    assert draft["author"] is None


def test_an_ordinary_compressed_xmp_packet_is_still_read():
    """The hardening mustn't lose the normal case: most real PDFs
    Flate-compress their XMP."""
    draft = parse_pattern_pdf(make_pdf(xmp_creators=["Dana Cohen"], xmp_compress=True), None)
    assert draft["author"] == "Dana Cohen"


def test_hostile_metadata_still_falls_back_to_the_byline():
    lines = ["Cozy Beanie", "Designed by Rivka Levi", *PATTERN_LINES[1:]]
    draft = _parse_quickly(make_pdf(lines=lines, xmp_raw=BILLION_LAUGHS))
    assert draft["author"] == "Rivka Levi"


# --- Creator: a person's name vs. the program that made the PDF -------------

@pytest.mark.parametrize(
    "name",
    [
        # Surnames that contain a software hint as a substring must survive.
        "Dana Rios", "Antonios Papadakis", "Mary Scanlon", "Anna Printz", "Petr Chromy",
        "Ruth Wordsworth", "Jo Officer", "Iosif Brodsky", "Excelsior Jones", "Lucy Prince",
        "Dana Cohen", "רבקה לוי",
    ],
)
def test_a_person_named_in_creator_is_kept(name):
    assert _pdf_author({"Creator": name}, [], []) == name


@pytest.mark.parametrize(
    "creator",
    [
        "Microsoft® Word for Microsoft 365", "Microsoft365", "Canva", "Adobe InDesign 18.2 (Macintosh)",
        "Acrobat PDFMaker 23 for Word", "Google Docs Renderer", "LibreOffice 7.6", "Writer", "WPS Writer",
        "Pages", "macOS Version 14.1 (Build 23B74) Quartz PDFContext", "Mac OS X 10.15 Quartz PDFContext",
        "iOS Version 17.1", "Chromium", "Chrome", "Skia/PDF m120", "PDFium", "pdfTeX-1.40.25",
        "Epson Scan 2", "HP Scan", "wkhtmltopdf 0.12.6", "Affinity Publisher 2",
    ],
)
def test_a_program_named_in_creator_is_not_the_author(creator):
    assert _pdf_author({"Creator": creator}, [], []) is None
