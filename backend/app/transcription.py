"""
Reads a knitting/crochet pattern out of photos (a printed page, a book, a
handwritten card) with a vision model (Groq first, Gemini as fallback),
so a photographed pattern goes through the same review-then-save flow as
a link or a file. Shares translation.py's _call_model (provider chain,
retries, JSON responses).

The model only transcribes -- it's asked to mark section and part headings
with "# " and keep one step per line, and scraper.parse_pattern_text then
does the actual splitting into materials/abbreviations/instructions, the
same way pasted text is handled.
"""

from .translation import TranslationError, _call_model

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
    TranslationError on any AI failure (no key, request error, bad
    response)."""
    result = _call_model(_PROMPT, images=images, schema=_SCHEMA)
    text = result.get("text") if isinstance(result, dict) else None
    if not isinstance(text, str):
        raise TranslationError("The AI returned no transcription text.")
    return text.strip()
