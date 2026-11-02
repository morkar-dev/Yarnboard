"""
Reads a knitting/crochet pattern out of photos (a printed page, a book, a
handwritten card) with Gemini's vision input, so a photographed pattern
goes through the same review-then-save flow as a link or a file. Shares
translation.py's Gemini call (key handling, retries, JSON responses).

The model only transcribes -- it's asked to mark section and part headings
with "# " and keep one step per line, and scraper.parse_pattern_text then
does the actual splitting into materials/abbreviations/instructions, the
same way pasted text is handled.
"""

import base64

from .translation import TranslationError, _call_gemini

MAX_PHOTOS = 5

_SCHEMA = {
    "type": "OBJECT",
    "properties": {"text": {"type": "STRING"}},
    "required": ["text"],
}

_PROMPT = """\
These photos show one knitting or crochet pattern, in order. Transcribe all \
of its text exactly as written, in the original language -- do not translate, \
summarize, or add anything.

Format:
- First line: the pattern's title.
- Put "# " before every section or part heading (for example Materials, \
Abbreviations, Instructions, Body, Sleeves), on its own line.
- One material, abbreviation, or instruction step per line.
- Leave out page numbers, headers/footers, and anything that isn't part of \
the pattern.

Return JSON: {"text": "<the transcription>"}. If the photos don't contain a \
readable pattern, return {"text": ""}.
"""


def transcribe_pattern_photos(images: list[bytes]) -> str:
    """Plain-text transcription of the pattern in `images` (JPEG bytes, in
    page order). Empty string if nothing readable was found. Raises
    TranslationError on any Gemini failure (no key, request error, bad
    response)."""
    parts = [
        {"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(image).decode("ascii")}}
        for image in images
    ]
    result = _call_gemini(_PROMPT, extra_parts=parts, schema=_SCHEMA)
    text = result.get("text") if isinstance(result, dict) else None
    if not isinstance(text, str):
        raise TranslationError("Gemini returned no transcription text.")
    return text.strip()
